/**
 * verify:ai-explanation-live — the product's validation explanation on the real Qwen3.5-0.8B, through
 * the production path and under its own deadline (Phase L, L1.8 follow-up).
 *
 * `benchmark:ai-model-0-8b` measures this request on the host directly, under a 240 s harness deadline,
 * so it could not see that the product gave every real explanation 30 s. This drives what
 * `ai:explainValidation` runs — `explainFlowValidation`, the production `AiService` with
 * `AUTHORING_LIMITS.timeoutMs`, `AiUtilityHostManager` and the real `ai-host.cjs` in a utility process —
 * over the benchmark's flow: a real explanation is delivered, a user cancel after 30 s still settles
 * within the 3 s ceiling, and a deadline that kills the host is followed by a reload and a delivered
 * explanation. It records counts and timings, never model text.
 *
 * NOT RUN (exit 0) without the runtime or the pack at ~/Downloads/Qwen3.5-0.8B-Q4_K_M.gguf. A pack that
 * is not the published object is refused. The pack is unpinned, so it is staged into a scratch model
 * root; `AI_MODEL_MANIFEST` is not touched.
 *
 * Run: npm run verify:ai-explanation-live
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import { HOST_PATH, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled, stageModelRoot } from "./ai-harness/launch.mts";

/** The published object, as `benchmark:ai-model-0-8b` accepts it. */
const PACK = Object.freeze({
  file: "Qwen3.5-0.8B-Q4_K_M.gguf",
  sizeBytes: 527_502_816,
  sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec"
});

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

console.log("verify:ai-explanation-live — the product's explanation on the real 0.8B, production path, own deadline\n");
const runtime = runtimeInstalled();
if (!runtime.installed) {
  console.log("NOT RUN: node-llama-cpp and its Windows CPU prebuilt are not installed (owner step 1 in L1-ai-foundation.md).");
  process.exit(0);
}
const candidate = path.join(os.homedir(), "Downloads", PACK.file);
if (!fs.existsSync(candidate)) {
  console.log(`NOT RUN: no model pack at ~/Downloads/${PACK.file}.`);
  process.exit(0);
}
const measured = await measurePack(candidate);
if (measured.sizeBytes !== PACK.sizeBytes || measured.sha256 !== PACK.sha256) {
  console.error(`REFUSED: ${candidate} is not the published ${PACK.file} (${measured.sizeBytes} bytes, sha256 ${measured.sha256}); download it again.`);
  process.exit(1);
}
const threads = deriveInferenceThreads(os.cpus().length);
console.log(`  runtime ${runtime.build}, pack ${PACK.file} ${measured.sha256.slice(0, 16)}…, ${threads} inference threads\n`);

const staged = stageModelRoot(candidate, measured.sha256);
const harnessDir = await buildAiHarness();
try {
  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "explain",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot,
      AWKIT_HARNESS_MODEL_PATH: staged.modelPath,
      AWKIT_HARNESS_MODEL_ID: "Qwen3.5-0.8B-unpinned",
      AWKIT_HARNESS_THREADS: String(threads),
      AWKIT_HARNESS_EXPECT_BUILD: runtime.build ?? ""
    },
    { timeoutMs: 480_000 }
  );
  if (!report) {
    check("the harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness ran every step", report.steps.length === 4, `${report.steps.length} steps`);
    // Counts, codes and timings only: the harness never records model text.
    for (const s of report.steps) if (s.detail) console.log(`    ${s.label}: ${JSON.stringify(s.detail)}`);
  }
} finally {
  fs.rmSync(harnessDir, { recursive: true, force: true });
  fs.rmSync(staged.root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
