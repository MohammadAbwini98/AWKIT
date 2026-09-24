/**
 * verify:ai-explanation-live, verify:ai-failure-analysis-live, verify:ai-locator-upgrade-live,
 * verify:ai-locator-quality-live — one product AI feature's own request on the real Qwen3.5-0.8B, through
 * the production path and under that feature's own deadline (Phase L, L1.8 follow-up). `--feature` picks
 * it; the explanation is the default.
 *
 * `benchmark:ai-model-0-8b` measures stand-in requests on the host directly, under a 240 s harness
 * deadline, so it could not see that the product gave every real answer 30 s. Each feature is driven
 * through the product's own code, the production `AiService` with that feature's limits,
 * `AiUtilityHostManager` and the real `ai-host.cjs` in a utility process:
 *   - validationExplanation: `explainFlowValidation` over the benchmark's flow. A real explanation is
 *     delivered, a user cancel after 30 s settles within the 3 s ceiling, and a deadline that kills the
 *     host is followed by a reload and a delivered explanation.
 *   - failureAnalysis: `analyzeFailure` over a typical and the largest L5a failure it sends, each of
 *     which must be ACCEPTED as a conclusion (the typical one citing its cause), and a bare runner
 *     timeout, which must be accepted as insufficient.
 *   - locatorUpgrade: `runLocatorUpgradeAttempts` over a typical and the largest L2 capture context.
 *   - locatorQuality: the same job over real Recorder captures on the Feature Test Lab, served here, with
 *     every plan proven by the product in real Chromium and each accepted one judged by the page
 *     (scripts/ai-harness/locatorQualityLive.ts). `--set d1` judges D1's container-scoped set instead, and
 *     `--controls` runs every scripted control in plain Node with no model (verify:ai-locator-quality-controls).
 *     Each live run, PASS, FAIL or INCONCLUSIVE, also saves its sanitized per-case evidence as a NEW file under
 *     docs/plans/ai-upgrade-v5/evidence/ before the scratch folders are removed; a failed save fails the run
 *     (scripts/ai-harness/locatorQualityEvidence.mts). The file is left for a person to review and commit.
 *   - authoringQuality: `explainFlowValidation` over L4b's labelled set, each answer delivered with every
 *     issue explained and no canary leaked, quality recorded (scripts/ai-harness/authoringQualityLive.ts);
 *     `--cases` runs it in parts. Each part also writes a redacted review capture to the local review
 *     store, the only place model text is kept (scripts/ai-harness/authoringQualityReview.ts).
 *   - errorQuality: `analyzeFailure` over L5's labelled set, each row delivered and saved with no canary
 *     leaked, L5's metrics recorded (scripts/ai-harness/errorQualityLive.ts).
 * Each answer must arrive before its deadline, and each step records counts and timings, never model text.
 *
 * NOT RUN (exit 0) without the runtime or the pack at ~/Downloads/Qwen3.5-0.8B-Q4_K_M.gguf. A pack that
 * is not the published object is refused. The pack is unpinned, so it is staged into a scratch model
 * root; `AI_MODEL_MANIFEST` is not touched.
 *
 * Run: npm run verify:ai-explanation-live | verify:ai-failure-analysis-live | verify:ai-locator-upgrade-live
 *      | verify:ai-locator-quality-live | verify:ai-locator-quality-live-d1 | verify:ai-locator-quality-controls
 *      | verify:ai-authoring-quality-live | verify:ai-error-quality-live
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import { reviewDir } from "./ai-harness/authoringQualityReview";
import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled, stageModelRoot, type HarnessReport } from "./ai-harness/launch.mts";
// Type-only: esbuild bundles the harness without checking it, so this puts the modes under typecheck:scripts.
import type {} from "./ai-harness/harnessMain";

/** The published object, as `benchmark:ai-model-0-8b` accepts it. */
const PACK = Object.freeze({
  file: "Qwen3.5-0.8B-Q4_K_M.gguf",
  sizeBytes: 527_502_816,
  sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec"
});
/** The id the harness gives the unpinned pack. */
const MODEL_ID = "Qwen3.5-0.8B-unpinned";

/** Harness mode, its step count, and a launcher budget under the 10-minute limit of the tool running it. */
const FEATURES: Readonly<Record<string, { mode: string; steps: number; timeoutMs: number; mockSite?: boolean; controls?: number; d1Steps?: number }>> = Object.freeze({
  validationExplanation: { mode: "explain", steps: 4, timeoutMs: 480_000 },
  failureAnalysis: { mode: "failureAnalysis", steps: 4, timeoutMs: 560_000 },
  locatorUpgrade: { mode: "locatorUpgrade", steps: 3, timeoutMs: 560_000 },
  // hello, 5 controls, 6 scenarios, the labelled-set verdict. Eleven model calls took ~520 s of harness
  // time on this host, so it gets what the 600 s tool ceiling leaves after the build and the launch.
  // `--set d1` (verify:ai-locator-quality-live-d1): hello, 5 D1 controls, 4 D1 cases (at most 8 model calls),
  // the D1 verdict, apart from the set above so it fits the same ceiling and leaves that set's evidence as it was.
  // `--controls` runs all 10 controls, after the saved evidence's own checks, with no model.
  locatorQuality: { mode: "locatorQuality", steps: 13, timeoutMs: 575_000, mockSite: true, controls: 10, d1Steps: 11 },
  // hello, the control, 9 labelled cases, the set's verdict. Nine explanations at ~45–90 s each pass the
  // 600 s tool ceiling: from such a tool, run it in parts (`--cases`).
  authoringQuality: { mode: "authoringQuality", steps: 12, timeoutMs: 1_200_000 },
  // hello, the control, 20 labelled cases (19 model calls, 2 rows with none), the set's verdict. Nineteen
  // analyses at ~35–100 s each pass the 600 s tool ceiling: from such a tool, run it in parts (`--cases`).
  errorQuality: { mode: "errorQuality", steps: 23, timeoutMs: 1_800_000 }
});

/** The Feature Test Lab on a free loopback port, for the modes that drive a real page. */
async function startMockSite(): Promise<{ server: ChildProcess; lab: string }> {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
  const lab = `http://127.0.0.1:${port}/recorder-lab/locator-upgrade`;
  const server = spawn(process.execPath, [path.join(ROOT, "mock-site", "server.mjs")], { env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(lab).then((r) => r.ok, () => false)) return { server, lab };
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw new Error(`the mock site never served ${lab}`);
}
const featureFlag = process.argv.indexOf("--feature");
const featureName = featureFlag >= 0 ? (process.argv[featureFlag + 1] ?? "") : "validationExplanation";
const feature = FEATURES[featureName as keyof typeof FEATURES];
if (!feature) {
  console.error(`unknown --feature "${featureName}"; one of ${Object.keys(FEATURES).join(", ")}`);
  process.exit(1);
}
// errorQuality and authoringQuality: `--cases id,id` runs part of the labelled set (hello, control, each
// case, verdict), so a caller with the 600 s tool ceiling can run it in parts. An unknown id fails the
// step count.
const casesFlag = process.argv.indexOf("--cases");
const cases = casesFlag >= 0 && ["errorQuality", "authoringQuality"].includes(feature.mode) ? (process.argv[casesFlag + 1] ?? "").split(",").filter(Boolean) : [];
// locatorQuality: `--set d1` judges D1's labelled set instead of the original one.
const setFlag = process.argv.indexOf("--set");
if (setFlag >= 0 && (feature.d1Steps === undefined || process.argv[setFlag + 1] !== "d1")) {
  console.error(`--set takes "d1", and only with --feature locatorQuality`);
  process.exit(1);
}
const d1Set = setFlag >= 0;
const expectedSteps = cases.length > 0 ? 3 + cases.length : d1Set ? feature.d1Steps! : feature.steps;

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

// `--controls` (locatorQuality, `verify:ai-locator-quality-controls`): the scripted controls alone, in plain
// Node over the served Feature Test Lab. No runtime, pack, Electron or model call, so they run where the live
// gate is NOT RUN. A pass shows the judge and fixtures are sound; it says nothing about the model.
if (process.argv.includes("--controls")) {
  if (feature.controls === undefined) {
    console.error(`--controls is only for --feature locatorQuality`);
    process.exit(1);
  }
  console.log(`${featureName} scripted controls — no model, runtime or Electron\n`);
  // The saved per-case evidence first: synthetic runs through the builder, save and settle a live run uses.
  const { evidenceControls } = await import("./ai-harness/locatorQualityEvidence.mts");
  await evidenceControls(check);
  const { runLocatorQualityLive } = await import("./ai-harness/locatorQualityLive");
  const site = await startMockSite();
  const steps: Array<{ label: string; ok: boolean; error?: string; detail?: unknown }> = [];
  try {
    await runLocatorQualityLive(
      {
        step: async (label, fn) => {
          try {
            const detail = await fn();
            steps.push({ label, ok: true, detail });
            return detail;
          } catch (error) {
            steps.push({ label, ok: false, error: String((error as Error)?.message ?? error) });
            return undefined;
          }
        },
        record: () => undefined,
        makeLiveContext: () => {
          throw new Error("--controls makes no model call");
        }
      },
      { lab: site.lab, controlsOnly: true }
    );
  } finally {
    site.server.kill();
  }
  for (const s of steps) {
    check(s.label, s.ok, s.error);
    if (s.detail) console.log(`    ${JSON.stringify(s.detail)}`);
  }
  check("every control ran", steps.length === feature.controls, `${steps.length} steps`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 && passed > 0 ? 0 : 1);
}

console.log(`${featureName} on the real 0.8B — the product's own request, production path, its own deadline\n`);
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
// locatorQuality saves each run's per-case evidence (ai-harness/locatorQualityEvidence.mts); loaded before the run so a broken
// module fails here, not after it.
const quality = feature.mode === "locatorQuality" ? await import("./ai-harness/locatorQualityEvidence.mts") : undefined;
const startedAt = new Date();
let mockSite: Awaited<ReturnType<typeof startMockSite>> | undefined;
let report: HarnessReport | null = null;
// A step may say it judged nothing (the D1 set, when no candidate was proven): INCONCLUSIVE, never PASS.
let inconclusive = false;
try {
  mockSite = feature.mockSite ? await startMockSite() : undefined;
  report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: feature.mode,
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot,
      AWKIT_HARNESS_MODEL_PATH: staged.modelPath,
      AWKIT_HARNESS_MODEL_ID: MODEL_ID,
      AWKIT_HARNESS_THREADS: String(threads),
      AWKIT_HARNESS_EXPECT_BUILD: runtime.build ?? "",
      ...(mockSite ? { AWKIT_HARNESS_LAB_URL: mockSite.lab } : {}),
      ...(d1Set ? { AWKIT_HARNESS_SET: "d1" } : {}),
      ...(cases.length > 0 ? { AWKIT_HARNESS_CASES: cases.join(",") } : {}),
      // The redacted answers a person reviews: local, outside the repository (authoringQualityReview.ts).
      ...(feature.mode === "authoringQuality" ? { AWKIT_HARNESS_REVIEW_DIR: reviewDir() } : {})
    },
    // A part stays under the tool ceiling, as the whole set did before it grew past it.
    { timeoutMs: cases.length > 0 ? Math.min(feature.timeoutMs, 575_000) : feature.timeoutMs }
  );
  if (!report) {
    check("the harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness ran every step", report.steps.length === expectedSteps, `${report.steps.length} steps`);
    // Counts, codes and timings only: the harness never records model text.
    for (const s of report.steps) if (s.detail) console.log(`    ${s.label}: ${JSON.stringify(s.detail)}`);
    inconclusive = report.steps.some((s) => s.ok && (s.detail as { inconclusive?: unknown } | undefined)?.inconclusive === true);
  }
} catch (error) {
  // Recorded, not thrown, so a locatorQuality run still saves what it measured below.
  check("the launcher ran the harness to its end", false, String((error as Error)?.message ?? error));
} finally {
  mockSite?.server.kill();
}

let exitCode = failed === 0 && passed > 0 ? (inconclusive ? 2 : 0) : 1;
if (quality) {
  // Saved from the report read above, then the scratch folders go: the console can be cut, the file keeps every case.
  const set = d1Set ? "d1" : "original";
  const settled = await quality.settleQualityRun({
    report,
    scratch: [harnessDir, staged.root],
    identity: { runId: quality.newRunId(startedAt), set, startedAt, source: quality.sourceRevision(), model: { id: MODEL_ID, file: PACK.file, sha256: measured.sha256, sizeBytes: measured.sizeBytes }, runtime: runtime.build },
    cases: quality.QUALITY_CASES[set],
    checks: { passed, failed },
    inconclusive
  });
  const { evidence } = settled;
  if (settled.file) {
    console.log(`\n  evidence: ${path.relative(ROOT, settled.file)} — ${evidence.result}, ${evidence.caseCounts.reached} of ${evidence.caseCounts.labelled} cases reached (review before committing)`);
  } else {
    check("the run's per-case evidence was saved", false, settled.error ?? "not saved");
  }
  if (!evidence.completed) console.log(`  FAIL: not every labelled case finished (harness ${evidence.harness}, not reached: ${evidence.notReached.join(", ") || "none"})`);
  if (settled.cleanup.length > 0) console.log(`  NOTE: a scratch folder was not removed (${settled.cleanup.join(", ")})`);
  exitCode = settled.exitCode;
} else {
  fs.rmSync(harnessDir, { recursive: true, force: true });
  fs.rmSync(staged.root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (exitCode === 2) console.log("INCONCLUSIVE: the checks held, but no candidate was browser-proven, so the judge judged nothing (exit 2).");
process.exit(exitCode);
