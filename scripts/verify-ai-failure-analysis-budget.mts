/**
 * verify:ai-failure-analysis-budget — the failure-analysis request against its token budgets, counted
 * on the real Qwen3.5-0.8B tokenizer: the pack's vocabulary only, no weights, no inference.
 *
 * `FAILURE_ANALYSIS_LIMITS.maxOutputTokens` is the cap `benchmark:ai-model` judges L1.8 at, and it is
 * only honest if every answer the product can accept fits inside it: an answer cut at the cap is invalid
 * JSON, discarded whole. So this fails when a limit is raised past the cap (a longer explanation, more
 * ids, another step), when the prompt stops showing every offered evidence line whole, or when the
 * counted template drifts from the host's. It runs inside the AI harness because node-llama-cpp needs
 * Electron's Node (scripts/ai-harness/failureAnalysisBudget.ts); it takes seconds.
 *
 * NOT RUN (exit 0) without the runtime or the pack at ~/Downloads/Qwen3.5-0.8B-Q4_K_M.gguf. A pack that
 * is not the published object is refused.
 *
 * Run: npm run verify:ai-failure-analysis-budget
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled, stageModelRoot } from "./ai-harness/launch.mts";

/** The published object, as `benchmark:ai-model-0-8b` accepts it. */
const PACK = Object.freeze({ file: "Qwen3.5-0.8B-Q4_K_M.gguf", sizeBytes: 527_502_816, sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec" });
const STEPS = 6;

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

console.log("failureAnalysis token budgets on the real Qwen3.5-0.8B tokenizer\n");
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

const staged = stageModelRoot(candidate, measured.sha256);
const harnessDir = await buildAiHarness();
try {
  const report = await runAiHarness(
    harnessDir,
    { AWKIT_HARNESS_MODE: "failureAnalysisBudget", AWKIT_HARNESS_HOST_PATH: HOST_PATH, AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot, AWKIT_HARNESS_MODEL_PATH: staged.modelPath, AWKIT_HARNESS_REPO_ROOT: ROOT },
    { timeoutMs: 120_000 }
  );
  if (!report) {
    check("the harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness ran every step", report.steps.length === STEPS, `${report.steps.length} steps`);
    for (const s of report.steps) if (s.detail) console.log(`    ${s.label}: ${JSON.stringify(s.detail)}`);
  }
} finally {
  fs.rmSync(harnessDir, { recursive: true, force: true });
  fs.rmSync(staged.root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
