/**
 * verify:ai-host-electron — the production `AiUtilityHostManager` and the real
 * `native-hosts/ai/ai-host.cjs` in a real Electron utility process (Phase L, L1.1). No model needed.
 *
 * Proves what the in-process `verify:ai-host` cannot: the host forks and handshakes over the real
 * MessagePort, reports whether the runtime is installed, refuses an out-of-root path and survives a
 * damaged GGUF without dying, keeps the runtime out of the main process, detects a killed host,
 * restarts it in a new process, opens the circuit on the third crash, and leaves no process behind
 * after dispose. Faults are injected from the harness (killing the pid), never from host code.
 *
 * Run: npm run verify:ai-host-electron
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HOST_PATH, buildAiHarness, printSteps, runAiHarness, runtimeInstalled } from "./ai-harness/launch.mts";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const runtime = runtimeInstalled();
console.log("verify:ai-host-electron — real utility process, production AiUtilityHostManager");
console.log(`  runtime installed: ${runtime.installed ? `yes (${runtime.build})` : "no (hello must report incompatible)"}\n`);

const harnessDir = await buildAiHarness();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-protocol-"));
const modelRoot = path.join(scratch, "models");
fs.mkdirSync(modelRoot, { recursive: true });
try {
  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "protocol",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: modelRoot,
      AWKIT_HARNESS_EXPECT_RUNTIME: runtime.installed ? "1" : "0"
    },
    { timeoutMs: 240_000 }
  );
  if (!report) {
    check("the harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness ran every step", report.steps.length >= 15, `${report.steps.length} steps`);
    check("no raw path or runtime text reached the manager's log", !(report.log ?? []).some((line) => line.includes(modelRoot)));
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(harnessDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
