/**
 * verify:ai-model-inspect — Phase L L8b.2's static header stage and L8b.3's probe on the REAL host, in a
 * real Electron app.
 *
 * Stages real models from ~/Downloads (hard links, each proven a manifest entry or not by its SHA-256)
 * in one model root, then runs `scripts/ai-harness/modelInspect.ts` (AWKIT_HARNESS_MODE=inspect):
 *  - the curated packs, and Qwen3.5-2B, which the manifest does not list, pass the header check through
 *    the real host and the pinned runtime's reader, and then the probe: each loads, keeps thinking off
 *    and answers the probe schema;
 *  - each hand-built header fails exactly its own check, including one that claims endless entries,
 *    which the host's deadline ends, and one compatible header of another architecture passes, then
 *    fails the probe's load (it has no weights) without taking the host down;
 *  - a copy of the host with its thinking-off pre-fill removed reads THINKING_NOT_DISABLED on a real
 *    Qwen3.5 model, so the probe's check is shown to observe the model;
 *  - the product path records each verdict on the model it ran on, with AI switched off;
 *  - the host never restarts and the main process never loads the runtime.
 * Without the pinned runtime it exits 2 (NOT RUN); a model missing from this machine (or no longer on the
 * side of the manifest its case needs) is NOT RUN for that model and the run exits 2, never 0.
 *
 * Run: npm run verify:ai-model-inspect
 */

import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled } from "./ai-harness/launch.mts";

/**
 * The two curated packs the manifest pins, and Qwen3.5-2B, which it does not: a real model an
 * administrator could register (L8b.1), so it must pass as an external model, not as a curated one.
 */
const PACK_NAMES = ["Qwen3.5-0.8B-Q4_K_M.gguf", "Qwen3.5-4B-Q4_K_M.gguf", "Qwen3.5-2B-Q4_K_M.gguf"];
const EXTERNAL_NAMES = new Set(["Qwen3.5-2B-Q4_K_M.gguf"]);
/**
 * The host, each real model's header and probe (two steps a model), thirteen hand-built headers, the
 * restart and outside-path checks, the header-only probe, the restart check after the probes, the
 * thinking mutant, two product steps and the main-process check.
 */
const EXPECTED_STEPS = 1 + PACK_NAMES.length * 2 + 13 + 2 + 2 + 1 + 2 + 1;

/**
 * The thinking mutant: the real host with the assistant turn's closed, empty think block removed, so the
 * model decides for itself whether to think. It sits in the repository's node_modules, where it resolves
 * the same pinned runtime the real host does; it is written for the run and deleted after it.
 */
const THINK_PREFILL = 'assistant\\n<think>\\n\\n</think>\\n\\n"';
const MUTANT_DIR = path.join(ROOT, "node_modules", ".awkit-l8b3-thinking-mutant");

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

console.log("verify:ai-model-inspect — L8b.2 header checks and the L8b.3 probe on the real host and runtime\n");
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

const hostSource = readFileSync(HOST_PATH, "utf8");
if (hostSource.split(THINK_PREFILL).length !== 2) {
  rmSync(root, { recursive: true, force: true });
  check("the host carries the thinking-off pre-fill exactly once, so its mutant is meaningful", false);
  process.exit(1);
}
mkdirSync(MUTANT_DIR, { recursive: true });
const mutantHost = path.join(MUTANT_DIR, "ai-host.cjs");
writeFileSync(mutantHost, hostSource.replace(THINK_PREFILL, 'assistant\\n"'));

const harnessDir = await buildAiHarness();
try {
  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "inspect",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MUTANT_HOST_PATH: mutantHost,
      AWKIT_HARNESS_MODEL_ROOT: modelRoot,
      AWKIT_HARNESS_EXPECT_BUILD: AI_RUNTIME_PIN.build!,
      AWKIT_HARNESS_PACKS: JSON.stringify(packs),
      AWKIT_HARNESS_THREADS: String(Math.max(1, Math.min(8, Math.floor(os.cpus().length / 3))))
    },
    // Each real probe loads its model and generates twice on the CPU.
    { timeoutMs: 1_200_000 }
  );
  if (!report) {
    check("the inspect harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness finished", report.complete === true, `stopped in: ${String(report.inFlight)}`);
    check("every step ran", report.steps.length === EXPECTED_STEPS - 2 * (PACK_NAMES.length - packs.length), `${report.steps.length} steps`);
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
    type Probe = { reply: { loaded?: boolean; loadMs?: number; thinkingOff?: boolean; stopReason?: string; text?: string }; standing: string; ms: number };
    const describeProbe = (result: Probe) =>
      `${result.standing}, ${result.ms} ms — load ${String(result.reply.loadMs)} ms, thinking off ${String(result.reply.thinkingOff)}, ${String(result.reply.stopReason)}, answer ${String(result.reply.text)}`;
    console.log("  · probes (real host, real models):");
    for (const [id, result] of Object.entries((report.probes ?? {}) as Record<string, Probe>)) console.log(`    ${id}: ${describeProbe(result)}`);
    if (report.mutantProbe) console.log(`    thinking-off pre-fill removed: ${describeProbe(report.mutantProbe as Probe)}`);
  }
} finally {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
  rmSync(harnessDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

for (const pack of missing) console.log(`NOT RUN for ${pack}`);
console.log(`\n${passed} passed, ${failed} failed${missing.length ? `, ${missing.length} pack(s) NOT RUN` : ""}`);
process.exit(failed === 0 && passed > 0 ? (missing.length > 0 ? 2 : 0) : 1);
