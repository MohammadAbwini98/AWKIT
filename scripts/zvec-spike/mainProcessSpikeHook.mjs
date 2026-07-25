// Phase 0B — invoked ONLY from the temporary AWKIT_ZVEC_SPIKE_HOST guard in app/main/main.ts.
// Runs inside the REAL packaged/dev AWKIT Electron main process (not a bare `electron <script>`
// invocation), because bare invocations of electron.exe with a script argument were found not to
// reach app.whenReady() in the automated Phase 0 shell — packaged app launches do. This hook lets
// Phase 0B prove Zvec inside the actual app-mode process without adding any production semantic
// service, IPC channel, or preload API.
import { app, utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
// zvecOpsHarness.mjs statically imports @zvec/zvec, so importing it at module scope would pull the
// native package into the MAIN process for every mode — including the Phase 0C/0D modes that must
// never load it. Worse, when the app runs from dist/win-unpacked (inside the repo) Node's upward
// node_modules walk silently satisfies that import from the REPOSITORY's node_modules, so the
// violation is invisible; running the portable EXE from %TEMP% is what exposed it.
// The legacy Phase 0B modes therefore import it lazily, at call time, and only for themselves.
import { ensureSpikeDirs, freshCollectionPath, removeCollectionDir, writeReport } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Console-independent trace: a packaged GUI app has no attached console, and a hard native crash
// produces no catchable JS error, so each step is flushed to disk immediately. The last line
// present in this file after a crash identifies exactly which step died.
const traceFile = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "zvec-phase-0", "reports", "app-mode-trace.log");
function trace(line) {
  try {
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    fs.appendFileSync(traceFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* no console available to fall back to */
  }
}

async function runMain() {
  trace("runMain:enter");
  const { runOpsHarness, destroyCollectionAt } = await import("./zvecOpsHarness.mjs");
  const memBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  ensureSpikeDirs();
  const collectionPath = freshCollectionPath("app-mode-main-host");
  removeCollectionDir(collectionPath);
  trace(`runMain:dirs-ready path=${collectionPath}`);

  // Probe the native module load separately from the ops harness, so a crash during bare module
  // load is distinguishable from a crash during an actual collection operation.
  try {
    trace("runMain:before-require-zvec");
    const mod = await import("@zvec/zvec");
    trace(`runMain:zvec-loaded exports=${Object.keys(mod).length}`);
  } catch (err) {
    trace(`runMain:zvec-load-FAILED ${err?.stack ?? err}`);
  }

  let result;
  let loadError = null;
  try {
    trace("runMain:before-ops-harness");
    result = await runOpsHarness(collectionPath, { runTag: "app-mode-main" });
    trace(`runMain:ops-harness-returned ok=${result.ok}`);
  } catch (err) {
    loadError = String(err?.stack ?? err);
    trace(`runMain:ops-harness-threw ${loadError}`);
    result = { ok: false, steps: [] };
  }
  let cleanupOk = true;
  try {
    if (result.ok) destroyCollectionAt(collectionPath);
  } catch {
    cleanupOk = false;
  }

  return {
    placement: "main-process (real app-mode)",
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    ok: result.ok && cleanupOk,
    steps: result.steps,
    loadError,
    measurements: {
      coldInitAndFullRunMs: performance.now() - startedAt,
      processRssBeforeBytes: memBefore,
      processRssAfterBytes: process.memoryUsage().rss
    }
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
}

async function runUtility() {
  const memBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  ensureSpikeDirs();
  const collectionPath = freshCollectionPath("app-mode-utility-host");
  removeCollectionDir(collectionPath);

  const report = { placement: "utility-process (real app-mode)", electronVersion: process.versions.electron, ok: false, steps: [], crashed: false, measurements: {} };
  let child;
  let exitCode = null;
  try {
    child = utilityProcess.fork(path.join(__dirname, "utilityWorker.mjs"), [], { stdio: "pipe" });
    child.on("exit", (code) => {
      exitCode = code;
    });

    await withTimeout(
      new Promise((resolve, reject) => {
        child.once("message", (m) => (m?.type === "workerReady" ? resolve() : reject(new Error(`unexpected first message: ${JSON.stringify(m)}`))));
        child.once("exit", (code) => reject(new Error(`utility process exited before ready, code=${code}`)));
      }),
      15_000,
      "utility-process startup"
    );

    const resultPromise = new Promise((resolve, reject) => {
      child.once("message", (m) => (m?.type === "result" ? resolve(m) : reject(new Error(`unexpected message: ${JSON.stringify(m)}`))));
      child.once("exit", (code) => reject(new Error(`utility process exited mid-operation, code=${code}`)));
    });
    child.postMessage({ collectionPath, runTag: "app-mode-utility" });
    const result = await withTimeout(resultPromise, 60_000, "utility-process operation");
    report.ok = Boolean(result.ok);
    report.steps = result.steps ?? [];
    report.loadError = result.loadError ?? null;
  } catch (err) {
    report.loadError = String(err?.stack ?? err);
  } finally {
    const shutdownStart = performance.now();
    if (child && exitCode === null) {
      child.kill();
      await withTimeout(new Promise((resolve) => child.once("exit", resolve)), 5000, "shutdown").catch(() => {});
    }
    report.measurements.shutdownMs = performance.now() - shutdownStart;
  }
  report.measurements.coldInitAndFullRunMs = performance.now() - startedAt;
  report.measurements.processRssBeforeBytes = memBefore;
  report.measurements.processRssAfterBytes = process.memoryUsage().rss;
  removeCollectionDir(collectionPath);
  return report;
}

// Phase 0B crash-isolation case: fork the utility host, make it hard-abort mid-operation, and
// record (a) whether the host detects the death, and (b) whether this main process survives it.
async function runUtilityCrashIsolation() {
  trace("crashIsolation:enter");
  const { runOpsHarness } = await import("./zvecOpsHarness.mjs");
  const report = { placement: "utility-process crash isolation", ok: false, hostSurvived: false, crashDetected: false, measurements: {} };
  let child;
  try {
    child = utilityProcess.fork(path.join(__dirname, "utilityWorker.mjs"), [], { stdio: "pipe" });
    await withTimeout(
      new Promise((resolve, reject) => {
        child.once("message", (m) => (m?.type === "workerReady" ? resolve() : reject(new Error("unexpected first message"))));
        child.once("exit", (code) => reject(new Error(`exited before ready code=${code}`)));
      }),
      15_000,
      "utility-process startup"
    );
    trace("crashIsolation:worker-ready");

    const start = performance.now();
    const exitPromise = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    child.postMessage({ collectionPath: freshCollectionPath("crash-isolation"), runTag: "crash", crashMidOperation: true });
    const exitCode = await withTimeout(exitPromise, 15_000, "crash detection");
    report.measurements.crashDetectionMs = performance.now() - start;
    report.crashDetected = true;
    report.exitCode = exitCode;
    trace(`crashIsolation:crash-detected exitCode=${exitCode} in ${report.measurements.crashDetectionMs}ms`);
  } catch (err) {
    report.loadError = String(err?.stack ?? err);
    trace(`crashIsolation:error ${report.loadError}`);
  }

  // If this line executes at all, the host main process survived the child's abort.
  report.hostSurvived = true;
  report.ok = report.crashDetected && report.hostSurvived;
  trace(`crashIsolation:host-survived=${report.hostSurvived}`);

  // Prove the host is still fully functional after the child died, not merely alive.
  try {
    const probePath = freshCollectionPath("post-crash-probe");
    removeCollectionDir(probePath);
    const probe = await runOpsHarness(probePath, { runTag: "post-crash" });
    report.hostFunctionalAfterCrash = probe.ok;
    removeCollectionDir(probePath);
    trace(`crashIsolation:host-functional-after-crash=${probe.ok}`);
  } catch (err) {
    report.hostFunctionalAfterCrash = false;
    trace(`crashIsolation:post-crash-probe-failed ${err?.stack ?? err}`);
  }
  return report;
}

// Phase 0C: exercise the STAGED extraResources native-host tree rather than the Phase 0B
// app.asar.unpacked layout. Loaded dynamically so the Phase 0B modes keep working unchanged.
async function runNativeHost() {
  trace("nativeHost:enter");
  const { runNativeHostChecks } = await import("./nativeHostDriver.mjs");
  const report = await runNativeHostChecks({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  });
  trace(`nativeHost:done ok=${report.ok}`);
  return report;
}

async function runNativeHostCrashIsolation() {
  trace("nativeHostCrash:enter");
  const { runCrashIsolationChecks } = await import("./crashIsolationDriver.mjs");
  const report = await runCrashIsolationChecks({ resourcesPath: process.resourcesPath });
  trace(`nativeHostCrash:done ok=${report.ok}`);
  return report;
}

async function runNativeHostBenchmark() {
  trace("nativeHostBenchmark:enter");
  const { runBenchmark } = await import("./benchmarkDriver.mjs");
  const report = await runBenchmark({ resourcesPath: process.resourcesPath });
  trace(`nativeHostBenchmark:done ok=${report.ok}`);
  return report;
}

async function runNativeHostLoad() {
  trace("nativeHostLoad:enter");
  const { runLoad } = await import("./loadDriver.mjs");
  const report = await runLoad({ resourcesPath: process.resourcesPath });
  trace(`nativeHostLoad:done profile=${report.profile}`);
  return report;
}

export async function runZvecSpikeHost(mode, { keepAlive = false } = {}) {
  if (mode === "main" || mode === "utility" || mode === "utility-crash") {
    const { setOpsTraceSink } = await import("./zvecOpsHarness.mjs");
    setOpsTraceSink(trace);
  }
  trace(`runZvecSpikeHost:enter mode=${mode} keepAlive=${keepAlive}`);
  const report =
    mode === "native-host"
      ? await runNativeHost()
      : mode === "native-host-crash"
        ? await runNativeHostCrashIsolation()
        : mode === "native-host-benchmark"
          ? await runNativeHostBenchmark()
          : mode === "native-host-load"
            ? await runNativeHostLoad()
            : mode === "utility-crash"
            ? await runUtilityCrashIsolation()
            : mode === "utility"
              ? await runUtility()
              : await runMain();
  trace(`runZvecSpikeHost:host-returned ok=${report.ok}`);
  report.mode = mode;
  report.realAppModeProcess = true;
  const reportFile = writeReport(`app-mode-${mode}-host-${Date.now()}.json`, report);
  console.log(`[zvec-spike] wrote ${reportFile}`);
  console.log(`[zvec-spike] result: ${JSON.stringify({ ok: report.ok, mode })}`);
  // keepAlive: the app must stay up so the harness can prove it survived and is still usable.
  if (!keepAlive) app.exit(report.ok ? 0 : 1);
}
