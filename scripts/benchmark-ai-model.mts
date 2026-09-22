/**
 * benchmark:ai-model — the L1.8 performance go/no-go (Phase L), on the qualifying host.
 *
 * Owner decision 2026-09-21: L1.8 is judged on THIS development machine with no CPU constraint (all
 * logical CPUs), model and ceilings unchanged. It is not a VMware measurement. The earlier run,
 * constrained to 6 logical CPUs by `start /affinity 3F` (3 physical cores), FAILED and stays on record
 * in docs/plans/ai-upgrade-v5/evidence/L1.8-benchmark.json; this harness never writes that file.
 *
 * Owner decision, later the same day: L1.8 is re-scoped to a smaller model, and both smaller Qwen3.5
 * packs are measured separately. `--pack <file>` picks one of PACKS (default: the pinned 4B). A pack
 * whose size or SHA-256 differs from its published identity is refused, never measured, because a
 * truncated download keeps the right file name.
 *
 * Inference uses the threads the product derives for the host's logical CPUs. Scenarios run one per
 * invocation, because the tool running this has a 10-minute limit. Each pack keeps its own results
 * file, keyed by a fingerprint (runtime build, pack SHA-256, CPU, threads); a different fingerprint
 * starts over. Any other machine is NOT RUN, so it can neither overwrite nor stand in for the
 * qualifying host. Run it until it reports every scenario complete, then it evaluates the ceilings.
 *
 * Run: npm run benchmark:ai-model | benchmark:ai-model-2b | benchmark:ai-model-0-8b   (repeat until complete;
 * no dot in a script name: the lease guard admits `benchmark:[a-z0-9:_-]+` only)
 *
 * The ceilings were committed BEFORE the first measurement, so the verdict is not fitted to the
 * numbers. They are product requirements for the target envelope, not observations.
 *
 * NOT RUN (exit 0 with a NOT RUN line) without the runtime or the pack, like verify:ai-model-live.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import { AI_HOST_TIMEOUTS } from "../src/ai/contracts/AiHostProtocol";
import {
  HOST_PATH,
  MODEL_FILE_NAME,
  PUBLISHED_PACK,
  ROOT,
  buildAiHarness,
  locateModelCandidate,
  machine,
  measurePack,
  runAiHarness,
  runtimeInstalled,
  stageModelRoot
} from "./ai-harness/launch.mts";
import { failureAnalysisPacket } from "./ai-harness/failureAnalysisPacket";
import { validationExplanationPacket } from "./ai-harness/validationExplanationPacket";

const EVIDENCE = path.join(ROOT, "docs", "plans", "ai-upgrade-v5", "evidence");
/**
 * The packs L1.8 may measure: the pinned 4B, and the two smaller ones of the owner's model re-scope
 * (same publisher, family and chat template, Apache-2.0). Size and SHA-256 are the published LFS
 * identity, read from both the tree API and the file page.
 */
const PACKS: Readonly<Record<string, { source: string; sizeBytes: number; sha256: string; results: string }>> = Object.freeze({
  [MODEL_FILE_NAME]: { ...PUBLISHED_PACK, results: "L1.8-benchmark-full-host.json" },
  "Qwen3.5-2B-Q4_K_M.gguf": {
    source: "https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF",
    sizeBytes: 1_270_808_032,
    sha256: "0bfe35afc9f05b7fac3fa04925e051ac7939a42a8a17ea11afc99701bea826cc",
    results: "L1.8-benchmark-full-host-Qwen3.5-2B-Q4_K_M.json"
  },
  "Qwen3.5-0.8B-Q4_K_M.gguf": {
    source: "https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF",
    sizeBytes: 527_502_816,
    sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
    results: "L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json"
  }
});
const packFlag = process.argv.indexOf("--pack");
const packName = packFlag >= 0 ? (process.argv[packFlag + 1] ?? "") : MODEL_FILE_NAME;
/** The machine the owner qualified (2026-09-21), as `os.cpus()` reports it. */
const QUALIFYING_HOST = Object.freeze({ cpuModel: "Intel(R) Core(TM) i7-8750H CPU @ 2.20GHz", logicalCpus: 12 });
const SCENARIOS = [
  "load",
  "packets:locatorUpgrade",
  "packets:validationExplanation",
  "packets:failureAnalysis",
  "cancel",
  "playwright",
  "batch"
] as const;

/** Pre-registered GO ceilings (committed before any measurement). */
const CEILINGS = Object.freeze({
  /** Cold model load. */
  coldLoadMs: 60_000,
  /** Resident memory of the AI host with the model loaded and a job running. */
  hostPeakWorkingSetMb: 6_144,
  /** Background jobs (locator semantic upgrade, failure analysis) are asynchronous: worst case at the output cap. */
  backgroundJobAtCapMs: 180_000,
  /** Validation explanation appears in the editor when ready: worst case at the output cap. */
  explanationAtCapMs: 120_000,
  /** A cancel or yield must free the CPUs promptly. */
  cancelLatencyMs: 3_000,
  /** The main process (Recorder, IPC) stays responsive while inference runs out of process. */
  mainLoopDelayP99Ms: 100,
  /** With the default yield-during-runs, a Playwright run is not slowed by queued AI work. */
  playwrightSlowdownWithYield: 1.15
});

type Scenario = (typeof SCENARIOS)[number];
interface Results {
  fingerprint: Record<string, unknown>;
  machine: ReturnType<typeof machine>;
  ceilings: typeof CEILINGS;
  scenarios: Partial<Record<Scenario, { completedAt: string; ok: boolean; steps: unknown[]; data: Record<string, unknown> }>>;
  verdict?: unknown;
}

console.log("benchmark:ai-model — L1.8 go/no-go on the qualifying host (this development machine, all logical CPUs, not VMware)\n");
const runtime = runtimeInstalled();
if (!runtime.installed) {
  console.log("NOT RUN: node-llama-cpp and its Windows CPU prebuilt are not installed (owner step 1 in L1-ai-foundation.md).");
  process.exit(0);
}
const pack = PACKS[packName];
if (!pack) {
  console.log(`NOT RUN: unknown pack "${packName}"; this gate measures only ${Object.keys(PACKS).join(", ")}.`);
  process.exit(0);
}
const inDownloads = path.join(os.homedir(), "Downloads", packName);
const candidate = packName === MODEL_FILE_NAME ? locateModelCandidate() : fs.existsSync(inDownloads) ? inDownloads : null;
if (!candidate) {
  console.log(`NOT RUN: no model pack at ~/Downloads/${packName} (owner download step in L1-ai-foundation.md).`);
  process.exit(0);
}
const RESULTS = path.join(EVIDENCE, pack.results);
const host = machine();
if (host.cpuModel !== QUALIFYING_HOST.cpuModel || host.logicalCpus !== QUALIFYING_HOST.logicalCpus) {
  console.log(`NOT RUN: this host (${host.cpuModel}, ${host.logicalCpus} logical CPUs) is not the qualifying host (${QUALIFYING_HOST.cpuModel}, ${QUALIFYING_HOST.logicalCpus}).`);
  process.exit(0);
}

const measured = await measurePack(candidate);
if (measured.sizeBytes !== pack.sizeBytes || measured.sha256 !== pack.sha256) {
  console.error(`REFUSED: ${candidate} is not the published ${packName} (${measured.sizeBytes} bytes, sha256 ${measured.sha256}); download it again.`);
  process.exit(1);
}
const threads = deriveInferenceThreads(host.logicalCpus);
// The cancel grace is part of the host behaviour measured here (awkit-g555 kill-and-restart), so a
// change to it starts the results over rather than mixing two behaviours in one verdict.
const fingerprint = { runtimeBuild: runtime.build, packSha256: measured.sha256, cpuModel: host.cpuModel, affinityMask: null, logicalCpus: host.logicalCpus, threads, cancelGraceMs: AI_HOST_TIMEOUTS.cancelGraceMs };

let results: Results | null = null;
try {
  results = JSON.parse(fs.readFileSync(RESULTS, "utf8")) as Results;
} catch {
  results = null;
}
if (!results || JSON.stringify(results.fingerprint) !== JSON.stringify(fingerprint) || JSON.stringify(results.ceilings) !== JSON.stringify(CEILINGS)) {
  results = { fingerprint, machine: host, ceilings: CEILINGS, scenarios: {} };
}
const save = () => {
  fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
  fs.writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`, "utf8");
};

/**
 * A packet built by product code changes whenever the product's request does. Its old numbers then
 * belong to a request the product no longer makes, so the scenario is measured again.
 */
const PACKET_IDENTITY: Partial<Record<Scenario, string>> = {
  "packets:validationExplanation": validationExplanationPacket().identity,
  "packets:failureAnalysis": failureAnalysisPacket().identity
};
const current = (scenario: Scenario) =>
  results!.scenarios[scenario]?.ok === true &&
  (results!.scenarios[scenario]?.data[scenario] as { packetIdentity?: string } | undefined)?.packetIdentity === PACKET_IDENTITY[scenario];
const pending = SCENARIOS.filter((scenario) => !current(scenario));
console.log(`  host: ${host.cpuModel}, ${host.logicalCpus} logical CPUs, ${host.totalMemoryGb} GB`);
console.log(`  unconstrained: all ${host.logicalCpus} logical CPUs, ${threads} inference threads (derived by the product)`);
console.log(`  runtime ${runtime.build}, pack ${packName} ${measured.sha256.slice(0, 16)}…`);
console.log(`  completed: ${SCENARIOS.length - pending.length}/${SCENARIOS.length}\n`);

if (pending.length > 0) {
  const scenario = pending[0];
  console.log(`Running scenario "${scenario}"…`);
  const staged = stageModelRoot(candidate, measured.sha256);
  const harnessDir = await buildAiHarness();
  try {
    const report = await runAiHarness(
      harnessDir,
      {
        AWKIT_HARNESS_MODE: "bench",
        AWKIT_HARNESS_SCENARIOS: scenario,
        AWKIT_HARNESS_HOST_PATH: HOST_PATH,
        AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot,
        AWKIT_HARNESS_MODEL_PATH: staged.modelPath,
        AWKIT_HARNESS_MODEL_ID: "benchmark-candidate",
        AWKIT_HARNESS_THREADS: String(threads),
        AWKIT_HARNESS_EXPECT_BUILD: runtime.build ?? "",
        AWKIT_HARNESS_ITERATIONS: "2",
        AWKIT_HARNESS_REPO_ROOT: ROOT
      },
      { timeoutMs: 540_000 }
    );
    if (!report) {
      console.error(`  ✗ scenario "${scenario}" wrote no report (timed out or Electron never started)`);
      process.exit(1);
    }
    for (const s of report.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.label} (${s.durationMs} ms)${s.error ? ` — ${s.error}` : ""}`);
    const { mode: _mode, ok, steps, log: _log, electron: _electron, node: _node, ...data } = report;
    results.scenarios[scenario] = { completedAt: new Date().toISOString(), ok, steps, data };
    save();
    if (!ok) {
      console.error(`\n  scenario "${scenario}" FAILED; it will be retried on the next run`);
      process.exit(1);
    }
    if (!current(scenario)) {
      console.error(`\n  scenario "${scenario}" measured a different packet than this checkout builds`);
      process.exit(1);
    }
  } finally {
    fs.rmSync(harnessDir, { recursive: true, force: true });
    fs.rmSync(staged.root, { recursive: true, force: true });
  }
  const left = SCENARIOS.filter((s) => !current(s)).length;
  if (left > 0) {
    console.log(`\n  ${left} scenario(s) left: run npm run benchmark:ai-model again`);
    process.exit(0);
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────────

type Iteration = { promptTokens: number; outputTokens: number; promptMs: number; generationMs: number; firstTokenMs: number; wallMs: number; promptTokensPerSec: number | null; generationTokensPerSec: number | null; maxOutputTokens: number; hostPeakWorkingSetMb: number; mainLoopDelayP99Ms: number };
const data = (scenario: Scenario) => results!.scenarios[scenario]?.data ?? {};
const iterations = (name: string) => ((data(`packets:${name}` as Scenario)[`packets:${name}`] as { iterations?: Iteration[] } | undefined)?.iterations ?? []);
const max = (values: number[]) => (values.length ? Math.max(...values) : Number.NaN);
const median = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : Number.NaN);

/** Worst case at the output cap: measured prompt time plus the cap at the measured generation rate. */
function atCap(runs: Iteration[]): number {
  return max(runs.map((run) => run.promptMs + (run.generationTokensPerSec ? (run.maxOutputTokens / run.generationTokensPerSec) * 1000 : Number.POSITIVE_INFINITY)));
}

const packetsSummary = Object.fromEntries(
  ["locatorUpgrade", "validationExplanation", "failureAnalysis"].map((name) => {
    const runs = iterations(name);
    return [
      name,
      {
        runs: runs.length,
        promptTokens: median(runs.map((r) => r.promptTokens)),
        promptTokensPerSec: median(runs.map((r) => r.promptTokensPerSec ?? Number.NaN)),
        generationTokensPerSec: median(runs.map((r) => r.generationTokensPerSec ?? Number.NaN)),
        firstTokenMsMedian: median(runs.map((r) => r.firstTokenMs)),
        wallMsMedian: median(runs.map((r) => r.wallMs)),
        wallMsMax: max(runs.map((r) => r.wallMs)),
        atOutputCapMs: Math.round(atCap(runs)),
        hostPeakWorkingSetMb: max(runs.map((r) => r.hostPeakWorkingSetMb)),
        mainLoopDelayP99Ms: max(runs.map((r) => r.mainLoopDelayP99Ms))
      }
    ];
  })
) as Record<string, { atOutputCapMs: number; hostPeakWorkingSetMb: number; mainLoopDelayP99Ms: number; wallMsMax: number }>;

const load = data("load").load as { hostLoadMs?: number; loadWallMs?: number; hostPeakWorkingSetMb?: number } | undefined;
const cancel = data("cancel").cancel as { duringPrompt?: { latencyMs: number }; duringGeneration?: { latencyMs: number } } | undefined;
const playwright = data("playwright").playwright as { slowdownWithYield?: number; slowdownBesideInference?: number } | undefined;
const batch = data("batch").batch as Record<string, unknown> | undefined;

const criteria = [
  { id: "coldLoad", measured: load?.loadWallMs, ceiling: CEILINGS.coldLoadMs },
  { id: "hostMemory", measured: max([load?.hostPeakWorkingSetMb ?? Number.NaN, ...Object.values(packetsSummary).map((p) => p.hostPeakWorkingSetMb)]), ceiling: CEILINGS.hostPeakWorkingSetMb },
  { id: "locatorUpgradeAtCap", measured: packetsSummary.locatorUpgrade.atOutputCapMs, ceiling: CEILINGS.backgroundJobAtCapMs },
  { id: "failureAnalysisAtCap", measured: packetsSummary.failureAnalysis.atOutputCapMs, ceiling: CEILINGS.backgroundJobAtCapMs },
  { id: "validationExplanationAtCap", measured: packetsSummary.validationExplanation.atOutputCapMs, ceiling: CEILINGS.explanationAtCapMs },
  { id: "cancelLatency", measured: max([cancel?.duringPrompt?.latencyMs ?? Number.NaN, cancel?.duringGeneration?.latencyMs ?? Number.NaN]), ceiling: CEILINGS.cancelLatencyMs },
  { id: "mainLoopDelay", measured: max(Object.values(packetsSummary).map((p) => p.mainLoopDelayP99Ms)), ceiling: CEILINGS.mainLoopDelayP99Ms },
  { id: "playwrightWithYield", measured: playwright?.slowdownWithYield, ceiling: CEILINGS.playwrightSlowdownWithYield }
].map((c) => ({ ...c, pass: typeof c.measured === "number" && Number.isFinite(c.measured) && c.measured <= c.ceiling }));

const verdict = {
  evaluatedAt: new Date().toISOString(),
  decision: criteria.every((c) => c.pass) ? "GO" : "NO-GO",
  criteria,
  packets: packetsSummary,
  informational: { playwrightSlowdownBesideInference: playwright?.slowdownBesideInference ?? null, batch: batch ?? null },
  scope: "The qualifying host (owner, 2026-09-21): this development machine, all logical CPUs, no affinity mask. Not a measurement of the production VMware server."
};
results.verdict = verdict;
save();

console.log("\nL1.8 criteria (ceilings pre-registered in this script)");
for (const c of criteria) console.log(`  ${c.pass ? "✓" : "✗"} ${c.id}: ${c.measured ?? "n/a"} ≤ ${c.ceiling}`);
console.log(`\nDecision: ${verdict.decision}   (results: ${path.relative(ROOT, RESULTS)})`);
process.exit(0);
