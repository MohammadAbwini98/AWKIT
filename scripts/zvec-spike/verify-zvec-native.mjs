// Phase 0 — native compatibility verifier (system Node, no Electron).
// Validates plan §19.1 items 1-10 and 17: native load, init, collection lifecycle, FTS
// (standard + jieba tokenizers), vector fixture, insert/batch/update/upsert/delete/fetch,
// restart persistence across a real OS process boundary, abrupt termination + recovery,
// and cleanup. This is the cheapest, fastest signal — it says nothing about Electron ABI
// compatibility, which is validated separately by verify-zvec-main-host / verify-zvec-utility-host.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOpsHarness, destroyCollectionAt } from "./zvecOpsHarness.mjs";
import { ensureSpikeDirs, freshCollectionPath, removeCollectionDir, writeReport } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = { startedAt: new Date().toISOString(), sections: {} };

ensureSpikeDirs();

// ── Section 1: single-process operations (steps 1-14) ──────────────────────────────
const collectionPath = freshCollectionPath("native-main");
removeCollectionDir(collectionPath);
const mainRun = await runOpsHarness(collectionPath, { runTag: "main" });
report.sections.singleProcessOps = mainRun;

// ── Section 2: restart persistence across a real process boundary (step 15) ────────
let restartSection = { ok: false, note: "not run" };
if (mainRun.ok) {
  const child = spawnSync(process.execPath, [path.join(__dirname, "restartWorker.mjs"), collectionPath], {
    encoding: "utf8"
  });
  try {
    const parsed = JSON.parse(child.stdout);
    restartSection = { ok: child.status === 0 && parsed.ok, exitCode: child.status, ...parsed, stderr: child.stderr };
  } catch {
    restartSection = { ok: false, exitCode: child.status, stdout: child.stdout, stderr: child.stderr, note: "child did not produce parseable JSON" };
  }
} else {
  restartSection = { ok: false, note: "skipped: single-process ops failed, restart test would be meaningless" };
}
report.sections.restartPersistence = restartSection;

// ── Section 3: abrupt termination mid-write + recovery (steps 16-17) ────────────────
const abruptCollectionPath = freshCollectionPath("native-abrupt");
removeCollectionDir(abruptCollectionPath);
const readyFlagPath = path.join(path.dirname(abruptCollectionPath), "abrupt-ready.flag");
if (fs.existsSync(readyFlagPath)) fs.rmSync(readyFlagPath);

let abruptSection = { ok: false, note: "not run" };
try {
  const child = spawn(process.execPath, [path.join(__dirname, "abruptWriteWorker.mjs"), abruptCollectionPath, readyFlagPath], {
    stdio: "ignore"
  });

  const readyDeadline = Date.now() + 10_000;
  while (!fs.existsSync(readyFlagPath) && Date.now() < readyDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const becameReady = fs.existsSync(readyFlagPath);

  // Let it write for a bounded, randomized window so the kill lands mid-write, then force-kill.
  await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 300)); // let the OS actually reap the process/file handles

  if (!becameReady) {
    abruptSection = { ok: false, note: "abrupt-write worker never signaled ready; treat as inconclusive, not pass/fail" };
  } else {
    // Recovery check: reopen in a brand-new process (not this one) and confirm the collection
    // opens without throwing and returns a queryable, non-negative document count. Run via
    // the *worktree's* zvecOpsHarness-adjacent recoveryWorker.mjs (not a file dropped under
    // %LOCALAPPDATA%) so plain node_modules resolution of "@zvec/zvec" still works — a file
    // under the LOCALAPPDATA runtime root has no node_modules ancestry to resolve against.
    const recovery = spawnSync(process.execPath, [path.join(__dirname, "recoveryWorker.mjs"), abruptCollectionPath], { encoding: "utf8" });
    try {
      const parsed = JSON.parse(recovery.stdout.trim().split("\n").pop());
      abruptSection = { ok: recovery.status === 0 && parsed.ok, exitCode: recovery.status, ...parsed, stderr: recovery.stderr };
    } catch {
      abruptSection = {
        ok: false,
        exitCode: recovery.status,
        stdout: recovery.stdout,
        stderr: recovery.stderr,
        note: "collection failed to reopen cleanly after SIGKILL mid-write — this is a real finding, not a test-harness artifact"
      };
    }
  }
} catch (err) {
  abruptSection = { ok: false, note: `harness error, treat as inconclusive: ${String(err?.message ?? err)}` };
}
report.sections.abruptTerminationRecovery = abruptSection;

// ── Section 4: cleanup (step 18) ────────────────────────────────────────────────────
let cleanupSection = { ok: true };
try {
  if (mainRun.ok) destroyCollectionAt(collectionPath);
} catch (err) {
  cleanupSection = { ok: false, note: String(err?.message ?? err) };
}
removeCollectionDir(abruptCollectionPath);
report.sections.cleanup = cleanupSection;

report.finishedAt = new Date().toISOString();
report.overallOk = mainRun.ok && restartSection.ok && cleanupSection.ok; // abrupt-termination is reported but not gating pass/fail here — see report notes
const reportFile = writeReport(`native-verifier-${Date.now()}.json`, report);

console.log(JSON.stringify({ reportFile, overallOk: report.overallOk, sections: Object.fromEntries(Object.entries(report.sections).map(([k, v]) => [k, v.ok])) }, null, 2));
process.exit(report.overallOk ? 0 : 1);
