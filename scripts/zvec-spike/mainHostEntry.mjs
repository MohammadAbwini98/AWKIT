// Phase 0 — Option A: Electron main-process host (plan §6.3, §19.1 item 15).
// Launched via `electron scripts/zvec-spike/mainHostEntry.mjs`. Runs the exact same ops
// harness as the native (system Node) verifier, but this time inside Electron's actual
// bundled Node/V8 runtime — this is the real ABI-compatibility proof, not the system-Node
// run. Zvec is loaded lazily, only because this spike command asked for it — never during
// normal AWKIT startup.
import { app } from "electron";
import os from "node:os";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { runOpsHarness, destroyCollectionAt } from "./zvecOpsHarness.mjs";
import { ensureSpikeDirs, freshCollectionPath, removeCollectionDir, writeReport } from "./paths.mjs";

const checkpointFile = process.env.ZVEC_SPIKE_CHECKPOINT_FILE;
function checkpoint(label) {
  if (!checkpointFile) return;
  fs.appendFileSync(checkpointFile, `${new Date().toISOString()} ${label}\n`);
}

checkpoint("script-start");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");

checkpoint("before-whenReady");
await app.whenReady();
checkpoint("after-whenReady");

const memBefore = process.memoryUsage().rss;
const cpuBefore = process.cpuUsage();
const startedAt = performance.now();

ensureSpikeDirs();
const collectionPath = freshCollectionPath("main-host");
removeCollectionDir(collectionPath);

checkpoint("before-runOpsHarness");
let result;
let loadError = null;
try {
  result = await runOpsHarness(collectionPath, { runTag: "main-host" });
} catch (err) {
  loadError = String(err?.stack ?? err);
  result = { ok: false, steps: [] };
}
checkpoint("after-runOpsHarness");

const coldInitMs = performance.now() - startedAt;
const cpuAfter = process.cpuUsage(cpuBefore);
const memAfter = process.memoryUsage().rss;

let cleanupOk = true;
try {
  if (result.ok) destroyCollectionAt(collectionPath);
} catch {
  cleanupOk = false;
}

const report = {
  placement: "main-process",
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  v8Version: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  osRelease: os.release(),
  loadError,
  ok: result.ok && cleanupOk,
  steps: result.steps,
  measurements: {
    coldInitAndFullRunMs: coldInitMs,
    processRssBeforeBytes: memBefore,
    processRssAfterBytes: memAfter,
    cpuUserMicros: cpuAfter.user,
    cpuSystemMicros: cpuAfter.system
  }
};

const reportFile = writeReport(`main-host-${Date.now()}.json`, report);
// Print for the orchestrating benchmark script to capture via stdout.
console.log(JSON.stringify({ reportFile, ...report }));

app.exit(report.ok ? 0 : 1);
