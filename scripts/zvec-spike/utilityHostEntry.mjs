// Phase 0 — Option B: Electron utility-process host (plan §6.3 Option B, §19.1 item 15).
// Launched via `electron scripts/zvec-spike/utilityHostEntry.mjs`. The main process here
// never imports @zvec/zvec directly — it only forks a utility process that does, and talks
// to it over a narrow message protocol with bounded startup/operation/shutdown timeouts.
// This is the direct comparison counterpart to mainHostEntry.mjs; same dataset/operations,
// different process placement.
import { app, utilityProcess } from "electron";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { ensureSpikeDirs, freshCollectionPath, removeCollectionDir, writeReport } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARTUP_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

app.disableHardwareAcceleration();
await app.whenReady();

ensureSpikeDirs();
const collectionPath = freshCollectionPath("utility-host");
removeCollectionDir(collectionPath);

const memBefore = process.memoryUsage().rss;
const cpuBefore = process.cpuUsage();
const startedAt = performance.now();

let child;
let crashed = false;
let exitCode = null;

const report = {
  placement: "utility-process",
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  v8Version: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  osRelease: os.release(),
  ok: false,
  steps: [],
  loadError: null,
  crashed: false,
  measurements: {}
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

try {
  child = utilityProcess.fork(path.join(__dirname, "utilityWorker.mjs"), [], { stdio: "pipe" });
  child.on("exit", (code) => {
    exitCode = code;
    if (code !== 0 && !report.ok) crashed = true;
  });

  await withTimeout(
    new Promise((resolve, reject) => {
      child.once("message", (m) => (m?.type === "workerReady" ? resolve() : reject(new Error(`unexpected first message: ${JSON.stringify(m)}`))));
      child.once("exit", (code) => reject(new Error(`utility process exited before signaling ready, code=${code}`)));
    }),
    STARTUP_TIMEOUT_MS,
    "utility-process startup"
  );

  const resultPromise = new Promise((resolve, reject) => {
    child.once("message", (m) => (m?.type === "result" ? resolve(m) : reject(new Error(`unexpected message: ${JSON.stringify(m)}`))));
    child.once("exit", (code) => reject(new Error(`utility process exited mid-operation, code=${code}`)));
  });
  child.postMessage({ collectionPath, runTag: "utility-host" });

  const result = await withTimeout(resultPromise, OPERATION_TIMEOUT_MS, "utility-process operation");
  report.ok = Boolean(result.ok);
  report.steps = result.steps ?? [];
  report.loadError = result.loadError ?? null;
} catch (err) {
  report.loadError = String(err?.stack ?? err);
} finally {
  const shutdownStart = performance.now();
  if (child && exitCode === null) {
    child.kill();
    await withTimeout(
      new Promise((resolve) => child.once("exit", resolve)),
      SHUTDOWN_TIMEOUT_MS,
      "utility-process shutdown"
    ).catch(() => {});
  }
  report.measurements.shutdownMs = performance.now() - shutdownStart;
}

report.crashed = crashed;
report.measurements.coldInitAndFullRunMs = performance.now() - startedAt;
report.measurements.processRssBeforeBytes = memBefore;
report.measurements.processRssAfterBytes = process.memoryUsage().rss;
const cpuAfter = process.cpuUsage(cpuBefore);
report.measurements.cpuUserMicros = cpuAfter.user;
report.measurements.cpuSystemMicros = cpuAfter.system;

removeCollectionDir(collectionPath);
const reportFile = writeReport(`utility-host-${Date.now()}.json`, report);
console.log(JSON.stringify({ reportFile, ...report }));
app.exit(report.ok ? 0 : 1);
