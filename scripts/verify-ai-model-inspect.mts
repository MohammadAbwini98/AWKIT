/**
 * verify:ai-model-inspect — Phase L L8b.2's static header stage on the REAL host, in a real Electron app.
 *
 * Stages real models from ~/Downloads (hard links, each proven a manifest entry or not by its SHA-256)
 * in one model root, then runs `scripts/ai-harness/modelInspect.ts` (AWKIT_HARNESS_MODE=inspect):
 *  - the curated packs, and Qwen3.5-2B, which the manifest does not list, pass the header check through
 *    the real host and the pinned runtime's reader;
 *  - each hand-built header fails exactly its own check, including one that claims endless entries,
 *    which the host's deadline ends, and one compatible header of another architecture passes;
 *  - the product path records a verdict on the model it ran on, with AI switched off;
 *  - the host never restarts and the main process never loads the runtime.
 * Without the pinned runtime it exits 2 (NOT RUN); a model missing from this machine (or no longer on the
 * side of the manifest its case needs) is NOT RUN for that model and the run exits 2, never 0.
 *
 * Run: npm run verify:ai-model-inspect
 */

import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

import { HOST_PATH, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled } from "./ai-harness/launch.mts";

/**
 * The two curated packs the manifest pins, and Qwen3.5-2B, which it does not: a real model an
 * administrator could register (L8b.1), so it must pass as an external model, not as a curated one.
 */
const PACK_NAMES = ["Qwen3.5-0.8B-Q4_K_M.gguf", "Qwen3.5-4B-Q4_K_M.gguf", "Qwen3.5-2B-Q4_K_M.gguf"];
const EXTERNAL_NAMES = new Set(["Qwen3.5-2B-Q4_K_M.gguf"]);
/** The real models, thirteen hand-built headers, and the host, outside-path, product and main-process steps. */
const EXPECTED_STEPS = 1 + PACK_NAMES.length + 13 + 2 + 2 + 1;

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
function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

console.log("verify:ai-model-inspect — L8b.2 static header checks on the real host and runtime\n");
const runtime = runtimeInstalled();
if (!runtime.installed || !AI_RUNTIME_PIN.build || runtime.build !== AI_RUNTIME_PIN.build) notRun(`the pinned runtime ${AI_RUNTIME_PIN.build} is not installed`);

const root = mkdtempSync(path.join(os.tmpdir(), "awkit-model-inspect-"));
const modelRoot = path.join(root, "models");
mkdirSync(modelRoot, { recursive: true });
const packs: Array<{ id: string; file: string; curated: boolean }> = [];
const missing: string[] = [];
for (const name of PACK_NAMES) {
  const source = path.join(os.homedir(), "Downloads", name);
  if (!existsSync(source)) {
    missing.push(`${name} (not in ~/Downloads)`);
    continue;
  }
  const measured = await measurePack(source);
  const entry = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256 && item.sizeBytes === measured.sizeBytes);
  // A curated name must be a manifest entry and an external one must not, or the case tests nothing.
  if (EXTERNAL_NAMES.has(name) === (entry !== undefined)) {
    missing.push(`${name} (${entry ? "now a manifest entry, so not an external model" : "not a pinned manifest entry"})`);
    continue;
  }
  const file = `${measured.sha256}.gguf`;
  try {
    linkSync(source, path.join(modelRoot, file));
  } catch {
    copyFileSync(source, path.join(modelRoot, file));
  }
  packs.push({ id: entry ? entry.id : name, file, curated: entry !== undefined });
}
if (packs.length === 0) {
  rmSync(root, { recursive: true, force: true });
  notRun("no curated pack in ~/Downloads");
}

const harnessDir = await buildAiHarness();
try {
  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "inspect",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: modelRoot,
      AWKIT_HARNESS_EXPECT_BUILD: AI_RUNTIME_PIN.build!,
      AWKIT_HARNESS_PACKS: JSON.stringify(packs)
    },
    { timeoutMs: 300_000 }
  );
  if (!report) {
    check("the inspect harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness finished", report.complete === true, `stopped in: ${String(report.inFlight)}`);
    check("every step ran", report.steps.length === EXPECTED_STEPS - (PACK_NAMES.length - packs.length), `${report.steps.length} steps`);
    check("no model path reached the managers' log", !(report.log ?? []).some((line) => line.includes(root) || line.includes(os.homedir())));
    type Result = { header: Record<string, unknown>; standing: string; ms: number };
    console.log("\n  · real models (facts from the real reader):");
    for (const [id, result] of Object.entries((report.curated ?? {}) as Record<string, Result>)) {
      const h = result.header;
      console.log(
        `    ${id}: ${result.standing}, ${result.ms} ms — v${String(h.ggufVersion)} ${String(h.architecture)}, context ${String(h.contextLength)}, ` +
          `${String(h.blockCount)} layers, ${String(h.tensorCount)} tensors, template ${String(h.chatTemplate)}`
      );
    }
    console.log("  · hand-built headers:");
    for (const [label, result] of Object.entries((report.cases ?? {}) as Record<string, Result>)) console.log(`    ${label}: ${result.standing} (${result.ms} ms)`);
  }
} finally {
  rmSync(harnessDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

for (const pack of missing) console.log(`NOT RUN for ${pack}`);
console.log(`\n${passed} passed, ${failed} failed${missing.length ? `, ${missing.length} pack(s) NOT RUN` : ""}`);
process.exit(failed === 0 && passed > 0 ? (missing.length > 0 ? 2 : 0) : 1);
