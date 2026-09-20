/**
 * verify:ai-inference-profile — the bounded L1.8 diagnosis behind the `locatorUpgrade` timeout.
 *
 * `benchmark:ai-model` establishes whether the ceilings are met. It cannot say WHY one is missed:
 * the host reports its timings only on completion, and a run that blows its ceiling never completes.
 * This runs the harness in `profile` mode (scripts/ai-harness/profile.ts) under the same constrained
 * CPU mask and separates the cost into prompt evaluation, decode, grammar and thread scaling.
 *
 * It is a DIAGNOSTIC gate, not a ceiling gate: it fails only when a probe produces no measurement,
 * so a regression that makes inference unmeasurable is caught, while the numbers themselves are
 * evidence for `benchmark:ai-model` to judge.
 *
 * NOT RUN (exit 0) without the runtime or the pack, like verify:ai-model-live.
 *
 * Run: npm run verify:ai-inference-profile
 */

import fs from "node:fs";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import {
  HOST_PATH,
  MODEL_FILE_NAME,
  ROOT,
  buildAiHarness,
  locateModelCandidate,
  machine,
  measurePack,
  printSteps,
  runAiHarness,
  runtimeInstalled
} from "./ai-harness/launch.mts";

const EVIDENCE = path.join(ROOT, "docs", "plans", "ai-upgrade-v5", "evidence", "L1.8-inference-profile.json");
const LOGICAL_CPUS = 6;
const AFFINITY_MASK = "3F";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};

console.log("verify:ai-inference-profile — where the locatorUpgrade time actually goes\n");

const runtime = runtimeInstalled();
if (!runtime.installed) {
  console.log("NOT RUN: node-llama-cpp and its Windows CPU prebuilt are not installed.");
  process.exit(0);
}
const candidate = locateModelCandidate();
if (!candidate) {
  console.log(`NOT RUN: no model pack at ~/Downloads/${MODEL_FILE_NAME} or AWKIT_AI_LIVE_MODEL.`);
  process.exit(0);
}
const host = machine();
if (host.logicalCpus < LOGICAL_CPUS) {
  console.log(`INCONCLUSIVE: this host has ${host.logicalCpus} logical CPUs; the profile needs ${LOGICAL_CPUS}.`);
  process.exit(0);
}

const measured = await measurePack(candidate);
const threads = deriveInferenceThreads(LOGICAL_CPUS);
console.log(`  host: ${host.cpuModel}, constrained to ${LOGICAL_CPUS} logical CPUs (mask 0x${AFFINITY_MASK}), ${threads} inference threads`);
console.log(`  runtime ${runtime.build}, pack ${measured.sha256.slice(0, 16)}…\n`);

// The profile does NOT go through the host, so it needs no confined model root and does not stage a
// copy: it opens the owner's pack where it already is. That keeps the OS page cache warm across
// runs, so a rerun measures inference rather than re-reading 2.7 GB from disk.
const harnessDir = await buildAiHarness();
let report: Awaited<ReturnType<typeof runAiHarness>> = null;
try {
  report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "profile",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: path.dirname(candidate),
      AWKIT_HARNESS_MODEL_PATH: candidate,
      AWKIT_HARNESS_MODEL_ID: "profile-candidate",
      AWKIT_HARNESS_THREADS: String(threads),
      AWKIT_HARNESS_WIDE_THREADS: String(LOGICAL_CPUS),
      AWKIT_HARNESS_EXPECT_BUILD: runtime.build ?? "",
      AWKIT_HARNESS_REPO_ROOT: ROOT
    },
    { timeoutMs: 540_000, affinityMask: AFFINITY_MASK }
  );
} finally {
  fs.rmSync(harnessDir, { recursive: true, force: true });
}

if (!report) {
  console.log("  ✗ the profile harness wrote no report at all");
  console.log("\nFAIL: 0 passed, 1 failed");
  process.exit(1);
}

printSteps(report, check);

const derived = report.derived as Record<string, number | null> | undefined;
check("the profile derived a split", Boolean(derived), "no derived section in the report");
if (derived) {
  for (const key of [
    "promptTokensPerSec",
    "decodeTokensPerSecNoGrammar",
    "decodeTokensPerSecWithGrammar",
    "grammarDecodeSlowdown",
    "hostVarianceRatio",
    "projectedLocatorUpgradeAtCapMs",
    "outputCapAloneMs",
    "projectedProductCallMs"
  ]) {
    check(`${key} was measured`, typeof derived[key] === "number" && Number.isFinite(derived[key] as number), String(derived[key]));
  }
  console.log("\n  where the time goes:");
  for (const [key, value] of Object.entries(derived)) console.log(`    ${key}: ${value ?? "n/a"}`);
}

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(
  EVIDENCE,
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      fingerprint: { runtimeBuild: runtime.build, packSha256: measured.sha256, cpuModel: host.cpuModel, affinityMask: AFFINITY_MASK, logicalCpus: LOGICAL_CPUS, threads },
      host: report.host ?? null,
      load: report.load ?? null,
      loadProgress: report.loadProgress ?? null,
      heartbeatMs: report.heartbeatMs ?? null,
      grammarMs: report.grammarMs ?? null,
      measurements: report.measurements ?? null,
      derived: derived ?? null,
      steps: report.steps,
      // The runtime's own log names the phase a killed step died in. Kept last: it is the longest
      // field and the only one that is raw runtime text.
      runtimeLog: report.runtimeLog ?? null
    },
    null,
    2
  )}\n`,
  "utf8"
);

const runtimeLog = Array.isArray(report.runtimeLog) ? (report.runtimeLog as string[]) : [];
if (failed > 0 && runtimeLog.length > 0) {
  console.log("\n  last runtime log lines:");
  for (const line of runtimeLog.slice(-12)) console.log(`    ${line}`);
}
if (failed > 0) console.log(`  heartbeat reached: ${String(report.heartbeatMs ?? "never")} ms`);

console.log(`\n  evidence: ${path.relative(ROOT, EVIDENCE)}`);
console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
