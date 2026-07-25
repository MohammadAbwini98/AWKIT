// Phase 0 — main-process vs utility-process comparison (plan §6.3 Phase 0 decision
// requirement, §20 "Process-placement comparison"). Runs both hosts and diffs their
// measurements. Bounded: if Electron never becomes ready in this execution environment
// (see the compatibility report's "Known limitations"), each run fails after its own
// timeout rather than hanging indefinitely, and the comparison is reported as
// inconclusive-by-environment rather than fabricated.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReport } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronBin = path.join(__dirname, "..", "..", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const RUN_TIMEOUT_MS = 30_000;

function runHost(scriptName, label) {
  return new Promise((resolve) => {
    const child = spawn(electronBin, [path.join(__dirname, scriptName)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ label, ok: false, inconclusive: true, note: `${label} did not complete within ${RUN_TIMEOUT_MS}ms (see compatibility report Known Limitations)`, stderrTail: stderr.slice(-2000) });
    }, RUN_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim().split("\n").pop());
        resolve({ label, ok: code === 0 && parsed.ok, exitCode: code, ...parsed });
      } catch {
        resolve({ label, ok: false, exitCode: code, note: "no parseable JSON result", stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) });
      }
    });
  });
}

const [mainResult, utilityResult] = await Promise.all([
  runHost("mainHostEntry.mjs", "main-process"),
  runHost("utilityHostEntry.mjs", "utility-process")
]);

const comparison = {
  generatedAt: new Date().toISOString(),
  main: mainResult,
  utility: utilityResult,
  bothRanToCompletion: mainResult.ok && utilityResult.ok
};

const reportFile = writeReport(`placement-comparison-${Date.now()}.json`, comparison);
console.log(JSON.stringify({ reportFile, ...comparison }, null, 2));
process.exit(comparison.bothRanToCompletion ? 0 : 1);
