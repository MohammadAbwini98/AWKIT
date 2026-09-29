/**
 * verify:ai-job-status — Phase L, L9 (`awkit-djnl.13`): the job-status contract, the bounded time budgets
 * and the ETA history, deterministically.
 *
 *   A. Budgets: defaults are the closed evidence values, every one inside committed bounds, kept apart
 *      from the L1.8 benchmark ceilings; out-of-range values are REFUSED (never clamped) on write and read
 *      as the default on load; an old settings file loads unchanged; a changed budget un-qualifies the
 *      features under it (E8).
 *   B. The tracker under an injected clock: every state and stage transition, determinate progress only
 *      in a measurable stage, an ETA only from `estimate` (never from elapsed time), overrun, cold/warm,
 *      requeue, terminal immutability, per-owner publishing, retention.
 *   C. The production `AiService` over the fake transport under a VIRTUAL clock (scripts/lib/virtual-clock):
 *      the exact stage sequence of a cold and a warm job, the runtime's load fraction as the only
 *      determinate progress, queue positions and hold reasons, cancel while queued and while running,
 *      timeout at exactly the feature's budget and recovery after it, a configured budget replacing the
 *      default, the model-load budget, yielding and requeue, GPU-Offload fallback and GPU-Only refusal
 *      profiles, disable and shutdown reasons, owner-only publishing, the measured history recorded only
 *      for completed jobs, and the probe's budget, progress and cancel.
 *   D. The ETA history on a real temporary filesystem: ranges and confidence from samples, cold and warm
 *      apart, caps per key and on keys, refusal of anything that is not a latency-class id or a duration,
 *      persistence across a restart, a newer version never overwritten, a corrupt file preserved,
 *      serialized concurrent writes, and no prompt text ever stored.
 *
 * Run: npm run verify:ai-job-status
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import type { AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import { AI_ETA_HISTORY_LIMITS, AI_ETA_HISTORY_VERSION, AiEtaHistoryStore, estimateFromSamples } from "@src/ai/AiEtaHistory";
import { AiJobTracker, type AiEtaEstimate, type AiJobSample, type AiJobStatus } from "@src/ai/AiJobStatus";
import { AiModelPackStore } from "@src/ai/AiModelPack";
import { describeQualification } from "@src/ai/AiQualification";
import { AI_SERVICE_LIMITS, AiService, type AiJobOutcome, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import { AiSettingsStore, normalizeAiSettings, sanitizeAiSettingsPatch } from "@src/ai/AiSettings";
import {
  AI_BUDGET_IDS,
  AI_TIME_BUDGETS,
  FEATURE_BUDGET,
  MAX_INFERENCE_BUDGET_MS,
  featuresWithChangedBudget,
  resolveAiTimeBudgets
} from "@src/ai/AiTimeBudgets";
import { AUTHORING_LIMITS } from "@src/ai/authoringExplanation";
import { AI_HOST_TIMEOUTS } from "@src/ai/contracts/AiHostProtocol";
import { FakeAiHostTransport, type FakeAiHostOptions, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { FAILURE_ANALYSIS_LIMITS } from "@src/ai/failureAnalysis";
import { FRAGMENT_ASSIST_LIMITS } from "@src/ai/fragmentAssist";
import { LOCATOR_ATTEMPT_LIMITS } from "@src/ai/locatorUpgradeAttempts";
import { AI_QUALIFIED_CONFIGURATIONS } from "@src/offline/AiQualifiedList";

import { virtualClock } from "./lib/virtual-clock.mts";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400)}`}`);
  }
}
const section = (title: string) => console.log(`\n${title}`);

const SECRET = "Zebra-Quokka-Secret-7731";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-job-status-"));
const MODEL_ROOT = path.join(TMP, "models");

// ── A. Budgets, settings and qualification ─────────────────────────────────────────────────────────
section("A. Budgets, settings and qualification");
{
  const seconds = (ms: number) => Number.isInteger(ms / 1000);
  check(
    "every budget's default lies inside its committed bounds, all whole seconds",
    AI_BUDGET_IDS.length === 7 && AI_BUDGET_IDS.every((id) => {
      const b = AI_TIME_BUDGETS[id];
      return b.minMs <= b.defaultMs && b.defaultMs <= b.maxMs && seconds(b.minMs) && seconds(b.defaultMs) && seconds(b.maxMs);
    }),
    AI_TIME_BUDGETS
  );
  // The defaults are the values the closed evidence ran under, and each feature reads its limit from the table.
  check("the explanation default is the historical 125 s and the feature uses it", AI_TIME_BUDGETS.authoringExplanation.defaultMs === 125_000 && AUTHORING_LIMITS.timeoutMs === 125_000);
  check("the failure-analysis default is the historical 185 s and the feature uses it", AI_TIME_BUDGETS.failureAnalysis.defaultMs === 185_000 && FAILURE_ANALYSIS_LIMITS.timeoutMs === 185_000);
  check("the locator default is the historical 185 s per attempt and the feature uses it", AI_TIME_BUDGETS.locatorAssistance.defaultMs === 185_000 && LOCATOR_ATTEMPT_LIMITS.timeoutMs === 185_000);
  check("the fragment default keeps its 30 s", AI_TIME_BUDGETS.fragmentAssistance.defaultMs === 30_000 && FRAGMENT_ASSIST_LIMITS.timeoutMs === 30_000);
  check("model load and probe defaults are the host's historical 120 s and 240 s", AI_TIME_BUDGETS.modelLoad.defaultMs === AI_HOST_TIMEOUTS.loadMs && AI_TIME_BUDGETS.compatibilityProbe.defaultMs === AI_HOST_TIMEOUTS.probeMs);
  // The L1.8 ceilings (scripts/benchmark-ai-model.mts) are evidence, not request timeouts: never the same number.
  check(
    "request timeouts are not the benchmark ceilings they were derived from (ceiling + 5 s)",
    AI_TIME_BUDGETS.authoringExplanation.defaultMs === 120_000 + 5_000 && AI_TIME_BUDGETS.failureAnalysis.defaultMs === 180_000 + 5_000
  );
  check("the cancel grace is its own, much shorter value", AI_HOST_TIMEOUTS.cancelGraceMs < AI_TIME_BUDGETS.fragmentAssistance.minMs);
  check(
    "the service's request limit is the largest committed maximum of an inference budget: bounded, never beyond",
    AI_SERVICE_LIMITS.maxJobTimeoutMs === MAX_INFERENCE_BUDGET_MS &&
      // Recomputed here from the committed table, so a limit that drifts from it cannot also move this side.
      MAX_INFERENCE_BUDGET_MS === Math.max(...Object.values(FEATURE_BUDGET).map((id) => AI_TIME_BUDGETS[id].maxMs)) &&
      Number.isFinite(MAX_INFERENCE_BUDGET_MS) &&
      Object.values(FEATURE_BUDGET).every((id) => AI_TIME_BUDGETS[id].maxMs <= MAX_INFERENCE_BUDGET_MS),
    MAX_INFERENCE_BUDGET_MS
  );

  const ok = sanitizeAiSettingsPatch({ timeBudgetSeconds: { authoringExplanation: 60, modelLoad: 300 } });
  check("an in-range budget is accepted as sent", ok.ok && JSON.stringify(ok.value.timeBudgetSeconds) === JSON.stringify({ authoringExplanation: 60, modelLoad: 300 }), ok);
  for (const [label, value] of [
    ["below its minimum", { authoringExplanation: 14 }],
    ["above its maximum", { authoringExplanation: 601 }],
    ["fractional", { failureAnalysis: 90.5 }],
    ["a string", { fragmentAssistance: "30" }],
    ["negative", { componentCopy: -1 }]
  ] as const) {
    const refused = sanitizeAiSettingsPatch({ timeBudgetSeconds: value });
    check(`a budget ${label} is refused, not clamped, with main's own bounds`, !refused.ok && /whole number of seconds from \d+ to \d+/.test(refused.errors.join(" ")), refused);
  }
  const unknown = sanitizeAiSettingsPatch({ timeBudgetSeconds: { thinking: 30 } });
  check("an unknown budget is refused", !unknown.ok && unknown.errors.some((e) => /unknown budget/.test(e)), unknown);
  check("a non-object budget map is refused", !sanitizeAiSettingsPatch({ timeBudgetSeconds: [30] }).ok);
  const reset = sanitizeAiSettingsPatch({ timeBudgetSeconds: {} });
  check("an empty map is accepted (every budget back to its default)", reset.ok && JSON.stringify(reset.value.timeBudgetSeconds) === "{}");

  const old = normalizeAiSettings({ enabled: true, yieldDuringRuns: false, idleUnloadMinutes: 5, featureTiers: { failureAnalysis: "T0" }, executionMode: "gpu-offload", vramReserveMb: 512 });
  check(
    "a pre-L9 settings file loads unchanged, with every budget at its default",
    old.enabled && !old.yieldDuringRuns && old.idleUnloadMinutes === 5 && old.featureTiers.failureAnalysis === "T0" && old.executionMode === "gpu-offload" && old.vramReserveMb === 512 && JSON.stringify(old.timeBudgetSeconds) === "{}",
    old
  );
  const tampered = normalizeAiSettings({ timeBudgetSeconds: { authoringExplanation: 5, failureAnalysis: 90, bogus: 1, modelLoad: "120" } });
  check("a stored value outside today's bounds reads as the default, never clamped; unknown keys dropped", JSON.stringify(tampered.timeBudgetSeconds) === JSON.stringify({ failureAnalysis: 90 }), tampered.timeBudgetSeconds);
  const resolved = resolveAiTimeBudgets({ failureAnalysis: 90, authoringExplanation: 5 });
  check("resolved budgets are ms, configured where valid, default elsewhere", resolved.failureAnalysis === 90_000 && resolved.authoringExplanation === 125_000 && resolved.modelLoad === 120_000, resolved);
  check("no feature reads a changed budget at the defaults", featuresWithChangedBudget(resolveAiTimeBudgets({})).length === 0);
  check(
    "a changed explanation budget changes exactly the features it governs",
    JSON.stringify(featuresWithChangedBudget(resolveAiTimeBudgets({ authoringExplanation: 60 })).sort()) === JSON.stringify(["safeFixRanking", "validationExplanation"])
  );

  const entry = AI_QUALIFIED_CONFIGURATIONS[0];
  const qualify = (changed: Parameters<typeof describeQualification>[0]["changedBudgetFeatures"]) =>
    describeQualification({
      compatibility: "compatible",
      modelSha256: entry.modelSha256,
      runtimeBuild: entry.runtimeBuild,
      configuration: { backend: "cpu", offload: "cpu", contextTokens: entry.contextTokens },
      featureBudgets: { locatorSemanticUpgrade: 256, failureAnalysis: 256, validationExplanation: 176 },
      hardwareClass: "cpu8-ram16g-novram",
      changedBudgetFeatures: changed
    });
  const base = qualify([]);
  check("(precondition) the curated evidence qualifies its three features at default budgets", base.label === "qualified" && base.qualifiedFeatures.length === 3, base);
  const oneChanged = qualify(["validationExplanation", "safeFixRanking"]);
  check(
    "a changed explanation budget removes only that feature's qualification; old evidence is never re-labelled",
    oneChanged.label === "qualified" && !oneChanged.qualifiedFeatures.includes("validationExplanation") && oneChanged.qualifiedFeatures.length === 2,
    oneChanged
  );
  const allChanged = qualify(["validationExplanation", "failureAnalysis", "locatorSemanticUpgrade"]);
  check("every qualified feature's budget changed reads Compatible but unqualified: TIME_BUDGET_CHANGED", allChanged.label === "compatible-unqualified" && allChanged.reason === "TIME_BUDGET_CHANGED", allChanged);
  check("latency is still never claimed by a qualification", allChanged.latency.claimed === false && base.latency.claimed === false);

  const store = new AiSettingsStore(path.join(TMP, "settings", "ai-settings.json"), () => undefined);
  const saved = await store.update({ timeBudgetSeconds: { compatibilityProbe: 600 } });
  const read = await store.read();
  check("a budget round-trips through the settings store", saved.timeBudgetSeconds.compatibilityProbe === 600 && read.timeBudgetSeconds.compatibilityProbe === 600, read);
  await store.update({ timeBudgetSeconds: {} });
  check("...and an empty map returns it to its default", JSON.stringify((await store.read()).timeBudgetSeconds) === "{}");
}

// ── B. The tracker under an injected clock ─────────────────────────────────────────────────────────
section("B. The tracker");
{
  let now = 1_000;
  const published: Array<{ owner: number; status: AiJobStatus }> = [];
  const recorded: Array<{ sample: AiJobSample; runMs: number }> = [];
  const estimates = new Map<string, AiEtaEstimate | null>();
  const asked: AiJobSample[] = [];
  const tracker = new AiJobTracker({
    now: () => now,
    estimate: (sample) => {
      asked.push(sample);
      return estimates.get(`${sample.kind}|${sample.cold}`) ?? null;
    },
    record: (sample, runMs) => recorded.push({ sample, runMs }),
    publish: (owner, status) => published.push({ owner, status }),
    retainMs: 10_000,
    maxRetained: 2
  });
  const profile = { modelId: "m", mode: "cpu" as const, backend: "cpu" as const, device: "cpu" as const, offload: "cpu", fallbackReason: null };

  tracker.open("k1", { kind: "validationExplanation", owner: 7, jobId: "req-1", budgetMs: 125_000, cancellable: true });
  let s = tracker.snapshot("k1")!;
  check("a new job is queued, stage queued, no ETA, no history verdict yet", s.state === "queued" && s.stage === "queued" && s.eta === null && s.noHistory === false && s.cold === null, s);
  check("it is published to its owner under the owner's id", published.at(-1)?.owner === 7 && published.at(-1)?.status.jobId === "req-1");
  tracker.update("k1", { queuePosition: 2, holdReason: "RUNS_ACTIVE" });
  s = tracker.snapshot("k1")!;
  check("a queued job carries its position and hold reason", s.queuePosition === 2 && s.holdReason === "RUNS_ACTIVE");
  now += 5_000;
  tracker.update("k1", { state: "running", stage: "prompt-preparation", queuePosition: null, holdReason: null });
  s = tracker.snapshot("k1")!;
  check("running clears the queue position; elapsed counts from submission", s.state === "running" && s.queuePosition === null && s.elapsedMs === 5_000, s);
  tracker.update("k1", { progress: { done: 5, total: 10, unit: "bytes" } });
  check("progress is refused outside a measurable stage (prompt preparation)", tracker.snapshot("k1")!.progress === null);
  tracker.update("k1", { stage: "model-load", progress: { done: 250, total: 1000, unit: "fraction" } });
  check("the runtime's load fraction is determinate in model-load", JSON.stringify(tracker.snapshot("k1")!.progress) === JSON.stringify({ done: 250, total: 1000, unit: "fraction" }));
  tracker.update("k1", { progress: { done: 2_000, total: 1_000, unit: "fraction" } });
  check("progress never exceeds its denominator", tracker.snapshot("k1")!.progress?.done === 1_000);
  tracker.update("k1", { progress: { done: 1, total: 0, unit: "fraction" } });
  check("a progress with no denominator is not progress", tracker.snapshot("k1")!.progress === null);
  tracker.update("k1", { progress: { done: 500, total: 1000, unit: "fraction" } });
  tracker.update("k1", { stage: "generation" });
  check("a stage change clears the previous stage's progress", tracker.snapshot("k1")!.progress === null);
  tracker.update("k1", { progress: { done: 64, total: 256, unit: "fraction" } });
  check("generation is never determinate, even when a count is offered", tracker.snapshot("k1")!.progress === null);

  tracker.update("k1", { cold: true, profile });
  s = tracker.snapshot("k1")!;
  check("with no measured history the status says so: no ETA, noHistory", s.eta === null && s.noHistory === true && s.cold === true, s);
  check("the estimate is asked for this kind, warmth and profile", asked.at(-1)?.kind === "validationExplanation" && asked.at(-1)?.cold === true && asked.at(-1)?.profile?.backend === "cpu");
  now += 600_000;
  check("a long run still has no ETA: nothing is extrapolated from elapsed time", tracker.snapshot("k1")!.eta === null && tracker.snapshot("k1")!.progress === null);

  estimates.set("validationExplanation|false", { minMs: 40_000, maxMs: 70_000, samples: 4, confidence: "medium" });
  tracker.open("k2", { kind: "validationExplanation", owner: 7, jobId: "req-2", budgetMs: 125_000, cancellable: true, state: "running" });
  tracker.update("k2", { cold: false, profile });
  s = tracker.snapshot("k2")!;
  check("a warm job gets the measured warm range, its sample count and confidence", s.eta?.warmth === "warm" && s.eta.remainingMinMs === 40_000 && s.eta.remainingMaxMs === 70_000 && s.eta.samples === 4 && s.eta.confidence === "medium" && !s.eta.overrun, s.eta);
  now += 30_000;
  s = tracker.snapshot("k2")!;
  check("the range counts down with running time", s.eta?.remainingMinMs === 10_000 && s.eta.remainingMaxMs === 40_000, s.eta);
  now += 45_000;
  s = tracker.snapshot("k2")!;
  check("past the longest measured run it says overrun, never a stretched estimate", s.eta?.overrun === true && s.eta.remainingMaxMs === 0 && s.eta.remainingMinMs === 0, s.eta);
  tracker.update("k2", { state: "queued", stage: "queued" });
  s = tracker.snapshot("k2")!;
  check("a requeued job (yielded) drops its ETA and warmth until it runs again", s.eta === null && s.cold === null && s.noHistory === false, s);

  estimates.set("failureAnalysis|true", { minMs: 90_000, maxMs: 10, samples: 2, confidence: "low" });
  tracker.open("k3", { kind: "failureAnalysis", owner: 8, jobId: "req-3", budgetMs: 185_000, cancellable: true, state: "running" });
  tracker.update("k3", { cold: true, profile });
  check("a malformed measured range (min above max) is treated as no history", tracker.snapshot("k3")!.eta === null && tracker.snapshot("k3")!.noHistory === true);

  const beforeRecord = recorded.length;
  now += 1_000;
  tracker.update("k1", { state: "cancelling" });
  tracker.update("k1", { state: "running" });
  check("a cancel requested is not undone by a later running update", tracker.snapshot("k1")!.state === "cancelling");
  tracker.close("k1", "cancelled", "CANCELLED");
  tracker.close("k3", "timed-out", "TIMEOUT");
  check("cancelled and timed-out jobs never join the measured history", recorded.length === beforeRecord);
  check("a window lists only its own jobs, finished ones included while retained", tracker.list(8).length === 1 && tracker.list(8)[0].jobId === "req-3" && tracker.list(7).every((j) => j.jobId !== "req-3"), tracker.list(8));
  s = tracker.snapshot("k1")!;
  check("a finished job is terminal: no progress, no ETA, not cancellable, with its reason", s.state === "cancelled" && s.terminalReason === "CANCELLED" && s.progress === null && s.eta === null && !s.cancellable, s);
  const frozen = s.elapsedMs;
  const frozenStage = s.stage;
  now += 5_000;
  tracker.update("k1", { state: "running", stage: "validation" });
  tracker.close("k1", "completed");
  s = tracker.snapshot("k1")!;
  check("a terminal job ignores later updates and a second close; its elapsed time stops", s.state === "cancelled" && s.stage === frozenStage && frozenStage !== "validation" && s.elapsedMs === frozen, s);

  tracker.open("k4", { kind: "fragmentSummary", owner: 7, jobId: "req-4", budgetMs: 30_000, cancellable: true, state: "running" });
  const started = now;
  tracker.update("k4", { cold: false, profile });
  now += 12_345;
  tracker.close("k4", "completed");
  check("a completed job's running time joins the history once, with its warmth and profile", recorded.length === beforeRecord + 1 && recorded.at(-1)?.runMs === now - started && recorded.at(-1)?.sample.cold === false && recorded.at(-1)?.sample.kind === "fragmentSummary", recorded.at(-1));
  tracker.open("k5", { kind: "fragmentSummary", owner: 7, jobId: "req-5", budgetMs: 30_000, cancellable: true, state: "running" });
  tracker.close("k5", "completed");
  check("a completed job whose warmth was never known is not recorded (it would pollute both)", recorded.length === beforeRecord + 1);

  tracker.open("bg", { kind: "locatorSemanticUpgrade", owner: null, jobId: "bg", budgetMs: 185_000, cancellable: true });
  check("background work nobody watches is published to no window", !published.some((p) => p.status.jobId === "bg"));
  now += 20_000;
  check("finished jobs are retained only for a bounded time", tracker.list(7).filter((j) => ["completed", "cancelled"].includes(j.state)).length === 0 && tracker.snapshot("k1") === null);

  // An asynchronous estimate that answers late is dropped once the question changed or the job ended.
  let resolveLate: (value: AiEtaEstimate) => void = () => undefined;
  const lateTracker = new AiJobTracker({ now: () => now, estimate: () => new Promise<AiEtaEstimate>((resolve) => (resolveLate = resolve)) });
  lateTracker.open("late", { kind: "validationExplanation", owner: 1, jobId: "late", budgetMs: 1, cancellable: true, state: "running" });
  lateTracker.update("late", { cold: true, profile });
  check("while an estimate is pending the status claims neither an ETA nor no-history", lateTracker.snapshot("late")!.eta === null && lateTracker.snapshot("late")!.noHistory === false);
  lateTracker.close("late", "failed", "HOST_ERROR");
  resolveLate({ minMs: 1, maxMs: 2, samples: 1, confidence: "low" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  check("an estimate arriving after the job ended is ignored", lateTracker.snapshot("late")!.eta === null && lateTracker.snapshot("late")!.state === "failed");
  // Requeued, then running warm: the cold question asked before the requeue is stale, and its answer is never used.
  const answers: Array<(value: AiEtaEstimate) => void> = [];
  const staleTracker = new AiJobTracker({ now: () => now, estimate: () => new Promise<AiEtaEstimate>((resolve) => answers.push(resolve)) });
  staleTracker.open("stale", { kind: "validationExplanation", owner: 1, jobId: "stale", budgetMs: 125_000, cancellable: true, state: "running" });
  staleTracker.update("stale", { cold: true, profile });
  staleTracker.update("stale", { state: "queued" });
  staleTracker.update("stale", { state: "running" });
  staleTracker.update("stale", { cold: false, profile });
  answers[0]?.({ minMs: 90_000, maxMs: 120_000, samples: 5, confidence: "medium" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const staleView = staleTracker.snapshot("stale")!;
  answers[1]?.({ minMs: 4_000, maxMs: 6_000, samples: 3, confidence: "medium" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const freshView = staleTracker.snapshot("stale")!;
  check(
    "an answer to an older question (asked before a requeue) is ignored; only the newer one is used",
    answers.length === 2 && staleView.eta === null && freshView.eta?.warmth === "warm" && freshView.eta.samples === 3,
    { stale: staleView.eta, fresh: freshView.eta }
  );
  const throwing = new AiJobTracker({ publish: () => { throw new Error("window gone"); }, record: () => { throw new Error("disk full"); } });
  throwing.open("t", { kind: "fragmentSummary", owner: 3, jobId: "t", budgetMs: 1, cancellable: true, state: "running" });
  throwing.update("t", { cold: false });
  throwing.close("t", "completed");
  check("a publisher or recorder that throws never disturbs the job", throwing.snapshot("t")?.state === "completed");
}

// ── C. The service under a virtual clock ───────────────────────────────────────────────────────────
section("C. AiService under a virtual clock");

const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "healthy", dispatchBlocked: false, activeWeight: 0, weightedBudget: 4, freeMemoryMb: 8_000 };
const RUNS: AiAdmissionView = { ...IDLE, activeRuns: 1 };
const SCHEMA = { type: "object", properties: { text: { type: "string", maxLength: 200 } }, required: ["text"], additionalProperties: false } as const;
const ANSWER = JSON.stringify({ text: "ok" });
const clock = virtualClock();
const BUDGET = 60 * 60_000;

function job(requestId: string, overrides: Partial<AiJobRequest> = {}): AiJobRequest {
  return {
    requestId,
    feature: "validationExplanation",
    priority: "interactive",
    prompt: { instructions: "Explain the validation issue.", fields: [{ name: "issue", text: `Missing start node ${SECRET}` }], maxDataChars: 1_000 },
    schema: SCHEMA as unknown as AiJobRequest["schema"],
    maxOutputTokens: 64,
    timeoutMs: 20_000,
    owner: { window: 7, requestId: `r-${requestId}` },
    ...overrides
  };
}

function harness(options: {
  script?: Array<FakeInferStep | string>;
  fake?: Partial<FakeAiHostOptions>;
  settings?: Partial<AiServiceSettings>;
  /** Replaces the fixed settings, for a job that must see them change. */
  settingsNow?: () => AiServiceSettings;
  gpu?: () => Promise<AiGpuReadiness>;
  estimates?: Map<string, AiEtaEstimate>;
} = {}) {
  const published: Array<{ owner: number; status: AiJobStatus }> = [];
  const recorded: Array<{ sample: AiJobSample; runMs: number }> = [];
  let admission = IDLE;
  const tracker = new AiJobTracker({
    now: clock.now,
    estimate: (sample) => options.estimates?.get(`${sample.kind}|${sample.cold}|${sample.profile?.backend ?? "none"}`) ?? null,
    record: (sample, runMs) => recorded.push({ sample, runMs }),
    publish: (owner, status) => published.push({ owner, status })
  });
  const script = options.script ?? [ANSWER];
  const fake = new FakeAiHostTransport({
    modelRoot: MODEL_ROOT,
    loadDelayMs: 3_000,
    loadProgress: [0.25, 0.5, 1],
    respond: (_request, index) => script[Math.min(index, script.length - 1)] ?? ANSWER,
    ...options.fake
  });
  const service = new AiService({
    transport: () => fake,
    ...(options.gpu ? { gpu: options.gpu } : {}),
    model: async () => ({ ok: true, modelId: "fake-model", modelPath: path.join(MODEL_ROOT, "model.gguf"), contextTokens: 4096 }),
    verifyModel: async () => true,
    settings: async () => options.settingsNow?.() ?? { enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0, ...options.settings },
    admission: () => admission,
    threads: 2,
    nonce: () => "0123456789abcdef",
    jobs: tracker
  });
  return {
    fake,
    service,
    tracker,
    published,
    recorded,
    hold: (view: AiAdmissionView) => {
      admission = view;
      service.notifyAdmissionChanged();
    },
    of: (jobId: string) => published.filter((p) => p.status.jobId === jobId).map((p) => p.status)
  };
}
type Harness = ReturnType<typeof harness>;
const stop = (h: Harness) => clock.settle(h.service.shutdown(), BUDGET);
/** Consecutive-distinct stages, the sequence a user sees. */
const stages = (statuses: AiJobStatus[]) => statuses.map((s) => s.stage).filter((stage, i, all) => i === 0 || all[i - 1] !== stage);
const lastOf = (statuses: AiJobStatus[]) => statuses.at(-1);

clock.install();
try {
  // 1. A cold job, then a warm one.
  {
    const h = harness({ script: [{ text: ANSWER, delayMs: 5_000, promptMs: 2_000 }] });
    const t0 = clock.now();
    const done = await clock.settle(h.service.submit(job("cold")), BUDGET);
    const cold = h.of("r-cold");
    check("a cold job answers ok", done?.value.status === "ok", done?.value);
    check(
      "its stages: queued, preparation, model check, load, prompt evaluation, generation, validation",
      JSON.stringify(stages(cold)) === JSON.stringify(["queued", "prompt-preparation", "copy-hash", "model-load", "prompt-evaluation", "generation", "validation"]),
      stages(cold)
    );
    check("it ends completed, with no terminal reason", lastOf(cold)?.state === "completed" && lastOf(cold)?.terminalReason === null, lastOf(cold));
    const loadSteps = cold.filter((s) => s.stage === "model-load" && s.progress).map((s) => s.progress!.done);
    check("the load reports the runtime's own fraction as determinate progress, in order", JSON.stringify(loadSteps) === JSON.stringify([250, 500, 1000]), loadSteps);
    check("progress appears only in measurable stages, never in prompt evaluation or generation", cold.every((s) => s.progress === null || ["copy-hash", "model-load"].includes(s.stage)));
    const gen = cold.find((s) => s.stage === "generation");
    const evalStart = cold.find((s) => s.stage === "prompt-evaluation");
    check("generation starts at the first token, not before", gen !== undefined && evalStart !== undefined && gen.at - evalStart.at === 2_000, [evalStart?.at, gen?.at]);
    check("the job was cold and ran on CPU & RAM", cold.some((s) => s.cold === true) && lastOf(cold)?.profile?.device === "cpu" && lastOf(cold)?.profile?.backend === "cpu", lastOf(cold)?.profile);
    check("the budget it ran under is reported, apart from any ETA", cold.every((s) => s.budgetMs === 20_000));
    check("with no history the first run says so", cold.some((s) => s.noHistory === true) && cold.every((s) => s.eta === null));
    const running = cold.find((s) => s.state === "running")!;
    check("its running time joins the history exactly once, cold", h.recorded.length === 1 && h.recorded[0].sample.cold === true && h.recorded[0].runMs === lastOf(cold)!.at - running.at && h.recorded[0].runMs >= 8_000, h.recorded);
    check("elapsed is counted from submission on the virtual clock", lastOf(cold)!.elapsedMs === (done?.atMs ?? 0) - t0, [lastOf(cold)?.elapsedMs, (done?.atMs ?? 0) - t0]);

    await clock.settle(h.service.submit(job("warm")), BUDGET);
    const warm = h.of("r-warm");
    check("the next job is warm: no model check, no load", warm.some((s) => s.cold === false) && !stages(warm).includes("model-load") && !stages(warm).includes("copy-hash"), stages(warm));
    check("...recorded as warm", h.recorded.length === 2 && h.recorded[1].sample.cold === false);
    check("every status went to the owning window only, under the owner's request id", h.published.every((p) => p.owner === 7) && h.published.every((p) => p.status.jobId.startsWith("r-")));
    check("no status carries prompt text", !JSON.stringify(h.published).includes(SECRET));
    await stop(h);
  }

  // 2. Measured history: an ETA range, counted down, and overrun.
  {
    const estimates = new Map<string, AiEtaEstimate>([["validationExplanation|false|cpu", { minMs: 4_000, maxMs: 6_000, samples: 3, confidence: "medium" }]]);
    const h = harness({ script: [ANSWER, { text: ANSWER, delayMs: 5_000, promptMs: 3_000 }, { text: ANSWER, delayMs: 9_000, promptMs: 1_000 }], estimates });
    await clock.settle(h.service.submit(job("warmup")), BUDGET);
    await clock.settle(h.service.submit(job("eta")), BUDGET);
    const eta = h.of("r-eta");
    const first = eta.find((s) => s.eta !== null);
    check("a warm job with measured history carries its range, sample count and confidence", first?.eta?.warmth === "warm" && first.eta.samples === 3 && first.eta.confidence === "medium" && first.eta.remainingMaxMs <= 6_000 && first.eta.remainingMinMs <= 4_000, first?.eta);
    const atGeneration = eta.find((s) => s.stage === "generation");
    check("three seconds in, the range has counted down by three seconds", atGeneration?.eta?.remainingMinMs === (first?.eta?.remainingMinMs ?? 0) - 3_000 && atGeneration?.eta?.remainingMaxMs === (first?.eta?.remainingMaxMs ?? 0) - 3_000, [first?.eta, atGeneration?.eta]);
    check("a job inside its range never reads overrun", eta.every((s) => !s.eta?.overrun));
    await clock.settle(h.service.submit(job("slow")), BUDGET);
    const slow = h.of("r-slow");
    const validation = slow.find((s) => s.stage === "validation");
    check("a job past its longest measured run says overrun", validation?.eta?.overrun === true && validation.eta.remainingMaxMs === 0, validation?.eta);
    await stop(h);
  }

  // 3. The queue: positions, hold reasons, cancel while queued.
  {
    const h = harness({ script: [{ text: ANSWER, delayMs: 2_000 }] });
    h.hold(RUNS);
    const a = h.service.submit(job("qa", { priority: "background" }));
    const b = h.service.submit(job("qb", { priority: "background" }));
    await clock.run(clock.now() + 100);
    const c = h.service.submit(job("qc", { priority: "interactive" }));
    await clock.run(clock.now() + 1_500);
    const pos = (id: string) => lastOf(h.of(id))?.queuePosition;
    check("queued jobs carry their positions, interactive ahead of background", pos("r-qc") === 1 && pos("r-qa") === 2 && pos("r-qb") === 3, [pos("r-qc"), pos("r-qa"), pos("r-qb")]);
    check("...and why they wait", ["r-qa", "r-qb", "r-qc"].every((id) => lastOf(h.of(id))?.holdReason === "RUNS_ACTIVE"), h.of("r-qa").map((s) => s.holdReason));
    check("cancelling a queued job answers true", h.service.cancel("qa"));
    const cancelled = await clock.settle(a, BUDGET);
    check("it ends cancelled with its reason, never having run", cancelled?.value.status === "cancelled" && lastOf(h.of("r-qa"))?.state === "cancelled" && lastOf(h.of("r-qa"))?.terminalReason === "CANCELLED" && !h.of("r-qa").some((s) => s.state === "running"));
    check("the job behind it moves up", pos("r-qb") === 2, pos("r-qb"));
    h.hold(IDLE);
    await clock.settle(Promise.all([b, c]), BUDGET);
    const qb = h.of("r-qb");
    check("when runs finish the hold clears and the queue drains in order", lastOf(h.of("r-qc"))?.state === "completed" && lastOf(qb)?.state === "completed" && qb.some((s) => s.queuePosition === 1), qb.map((s) => s.queuePosition));
    await stop(h);
  }

  // 4. Cancel while running, timeout at exactly the budget, and recovery.
  {
    const h = harness({ script: [{ hang: true }, { hang: true, killOnCancel: true }, ANSWER, ANSWER], fake: { loadDelayMs: 1_000 } });
    const running = h.service.submit(job("cr"));
    await clock.run(clock.now() + 5_000);
    check("(precondition) the job is running", lastOf(h.of("r-cr"))?.state === "running" && lastOf(h.of("r-cr"))?.stage === "prompt-evaluation", lastOf(h.of("r-cr")));
    check("cancelling it answers true", h.service.cancel("cr"));
    check("it reads cancelling at once", h.of("r-cr").some((s) => s.state === "cancelling" && !s.cancellable));
    const cr = await clock.settle(running, BUDGET);
    check("...then cancelled, with its reason", cr?.value.status === "cancelled" && lastOf(h.of("r-cr"))?.state === "cancelled" && lastOf(h.of("r-cr"))?.terminalReason === "CANCELLED");

    const started = clock.now();
    const timed = await clock.settle(h.service.submit(job("to", { timeoutMs: 20_000 })), BUDGET);
    const to = h.of("r-to");
    const ended = lastOf(to);
    check("a job stuck in prompt evaluation ends timed-out, not failed, with TIMEOUT", timed?.value.status === "failed" && ended?.state === "timed-out" && ended.terminalReason === "TIMEOUT", ended);
    check("...at its budget, bounded by the cancel", (timed?.atMs ?? 0) - started >= 20_000 && (timed?.atMs ?? 0) - started <= 20_000 + AI_HOST_TIMEOUTS.cancelMs + 1_000, (timed?.atMs ?? 0) - started);
    const next = await clock.settle(h.service.submit(job("after")), BUDGET);
    const after = h.of("r-after");
    check("the next job recovers: a fresh host, the model loaded again (cold), answered", next?.value.status === "ok" && after.some((s) => s.cold === true) && stages(after).includes("model-load"), stages(after));
    await stop(h);
  }

  // 5. A configured budget replaces the default; the model-load budget; yielding.
  {
    const budgets = resolveAiTimeBudgets({ authoringExplanation: 20, modelLoad: 30 });
    const h = harness({ script: [{ hang: true }], settings: { budgets } });
    const started = clock.now();
    const out = await clock.settle(h.service.submit(job("budget", { timeoutMs: AUTHORING_LIMITS.timeoutMs })), BUDGET);
    check("the configured 20 s budget replaces the feature's 125 s default", h.of("r-budget").every((s) => s.budgetMs === 20_000) && lastOf(h.of("r-budget"))?.state === "timed-out", h.of("r-budget").map((s) => s.budgetMs));
    check("...and ends the job at 20 s, not 125 s", (out?.atMs ?? 0) - started < 60_000, (out?.atMs ?? 0) - started);
    await stop(h);

    const slowLoad = harness({ fake: { loadDelayMs: 45_000 }, settings: { budgets } });
    const load = await clock.settle(slowLoad.service.submit(job("slowload")), BUDGET);
    check("a load past the model-load budget fails LOAD_FAILED, with its reason", load?.value.status === "failed" && lastOf(slowLoad.of("r-slowload"))?.state === "failed" && lastOf(slowLoad.of("r-slowload"))?.terminalReason === "LOAD_FAILED", lastOf(slowLoad.of("r-slowload")));
    await stop(slowLoad);

    const y = harness({ script: [{ text: ANSWER, delayMs: 10_000 }] });
    const pending = y.service.submit(job("yield"));
    await clock.run(clock.now() + 5_000);
    y.hold(RUNS);
    await clock.run(clock.now() + 2_000);
    const yielded = y.of("r-yield");
    const requeued = [...yielded].reverse().find((s) => s.state === "queued");
    check("a running job yields to a run: queued again, why, with its ETA and warmth reset", requeued !== undefined && requeued.holdReason === "RUNS_ACTIVE" && requeued.eta === null && requeued.cold === null && yielded.findIndex((s) => s.state === "running") < yielded.lastIndexOf(requeued), yielded.map((s) => s.state));
    y.hold(IDLE);
    const finished = await clock.settle(pending, BUDGET);
    check("...and completes once the run ends", finished?.value.status === "ok" && lastOf(y.of("r-yield"))?.state === "completed");
    await stop(y);
  }

  // 6. Where it runs: GPU-Offload fallback, GPU-Only refusal. No GPU name, no fabricated GPU claim.
  {
    const noPack = async () => ({ ok: false as const, reason: "BACKEND_PACK_MISSING" as const });
    // Measured history exists for every placement, so a placement assumed before the load would show as an ETA.
    const anyPlacement: AiEtaEstimate = { minMs: 1_000, maxMs: 2_000, samples: 3, confidence: "medium" };
    const everywhere = new Map(["cpu", "vulkan"].map((backend) => [`validationExplanation|true|${backend}`, anyPlacement] as const));
    const offload = harness({ settings: { executionMode: "gpu-offload" }, gpu: noPack, estimates: everywhere });
    await clock.settle(offload.service.submit(job("fallback")), BUDGET);
    const fb = lastOf(offload.of("r-fallback"));
    check("GPU-Offload without a usable GPU runs on CPU & RAM, and the profile says why", fb?.state === "completed" && fb.profile?.device === "cpu" && fb.profile.mode === "gpu-offload" && fb.profile.fallbackReason === "BACKEND_PACK_MISSING", fb?.profile);
    check("...its first load under a GPU mode claims no expected placement for an ETA", offload.of("r-fallback").every((s) => s.eta === null));
    await stop(offload);
    const only = harness({ settings: { executionMode: "gpu-only" }, gpu: noPack });
    await clock.settle(only.service.submit(job("refused")), BUDGET);
    const rf = lastOf(only.of("r-refused"));
    check("GPU-Only refuses and the job ends failed with GPU_UNAVAILABLE", rf?.state === "failed" && rf.terminalReason === "GPU_UNAVAILABLE", rf);
    check("no status names a device, only CPU or GPU", !JSON.stringify(offload.published.concat(only.published)).match(/"device":"(?!cpu|gpu)/));
    await stop(only);
  }

  // 7. Switched off, shut down, owners.
  {
    let enabled = true;
    const h = harness({ script: [{ text: ANSWER, delayMs: 3_000 }], settingsNow: () => ({ enabled, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }) });
    h.hold(RUNS);
    const queued = h.service.submit(job("off"));
    await clock.run(clock.now() + 500);
    enabled = false;
    h.hold(IDLE);
    await clock.settle(queued, BUDGET);
    check("a queued job ends failed DISABLED when AI is switched off", lastOf(h.of("r-off"))?.state === "failed" && lastOf(h.of("r-off"))?.terminalReason === "DISABLED", lastOf(h.of("r-off")));
    enabled = true;
    h.hold(RUNS);
    const waiting = h.service.submit(job("down"));
    await clock.run(clock.now() + 500);
    await stop(h);
    await clock.settle(waiting, BUDGET);
    check("a queued job ends failed SHUTDOWN on shutdown", lastOf(h.of("r-down"))?.state === "failed" && lastOf(h.of("r-down"))?.terminalReason === "SHUTDOWN");

    const o = harness();
    await clock.settle(o.service.submit(job("nobody", { owner: undefined })), BUDGET);
    check("a job with no owner is tracked but published to nobody", o.published.length === 0 && o.tracker.snapshot("nobody")?.state === "completed");
    const refused = (outcome: { value?: unknown } | undefined) =>
      (outcome?.value as AiJobOutcome | undefined)?.status === "rejected" && (outcome?.value as { code?: string }).code === "INVALID_REQUEST";
    const badWindow = await clock.settle(o.service.submit(job("badwindow", { owner: { window: -1, requestId: "fine-id" } })), BUDGET);
    const badId = await clock.settle(o.service.submit(job("badid", { owner: { window: 1, requestId: "x y" } })), BUDGET);
    check("a malformed owner is an invalid request: a bad window, and a bad request id on a good window", refused(badWindow) && refused(badId));
    await stop(o);
  }

  // 8. The compatibility probe: its budget, the runtime's load fraction, and cancel reaching the host.
  {
    const updates: unknown[] = [];
    const h = harness({ fake: { loadDelayMs: 4_000, loadProgress: [0.5, 1] } });
    const probe = await clock.settle(h.service.probeModel(path.join(MODEL_ROOT, "model.gguf"), (update) => updates.push(update)), BUDGET);
    check("a probe forwards the runtime's own load fraction", probe?.value !== null && JSON.stringify(updates) === JSON.stringify([{ stage: "load", fraction: 0.5 }, { stage: "load", fraction: 1 }]), updates);
    check("...and answers with nothing ending it early", h.service.probeEndedBy() === null);
    await stop(h);
    const slow = harness({ fake: { loadDelayMs: 90_000 }, settings: { budgets: resolveAiTimeBudgets({ compatibilityProbe: 60 }) } });
    const started = clock.now();
    const late = await clock.settle(slow.service.probeModel(path.join(MODEL_ROOT, "model.gguf")), BUDGET);
    check("a probe past its configured budget answers nothing, ended by the deadline", late?.value === null && slow.service.probeEndedBy() === "AI_HOST_TIMEOUT" && (late?.atMs ?? 0) - started < 90_000, [late?.atMs, slow.service.probeEndedBy()]);
    check("cancelling with no probe running answers false", slow.service.cancelProbe() === false);
    const running = slow.service.probeModel(path.join(MODEL_ROOT, "model.gguf"));
    await clock.run(clock.now() + 1_000);
    check("cancelling a running probe answers true and sends the cancel for that probe to the host", slow.service.cancelProbe() === true && slow.fake.requests.some((r) => r.type === "cancel" && /^probe#/.test(r.jobId)));
    await clock.settle(running, BUDGET);
    await stop(slow);
  }
} catch (error) {
  check("the virtual-clock section ran to completion", false, error instanceof Error ? error.stack : String(error));
} finally {
  clock.uninstall();
}

// ── D. The ETA history on a real filesystem ────────────────────────────────────────────────────────
section("D. ETA history");
{
  const one = estimateFromSamples([42_000]);
  check("one sample is a point range of low confidence", one?.minMs === 42_000 && one.maxMs === 42_000 && one.samples === 1 && one.confidence === "low", one);
  const three = estimateFromSamples([30_000, 50_000, 40_000]);
  check("three samples span min to max, medium confidence", three?.minMs === 30_000 && three.maxMs === 50_000 && three.confidence === "medium", three);
  const ten = estimateFromSamples([10, 20, 30, 40, 50, 60, 70, 80, 90, 10_000].map((n) => n * 1_000));
  check("ten samples trim the outer tenths and read high confidence", ten?.minMs === 10_000 && ten.maxMs === 90_000 && ten.confidence === "high" && ten.samples === 10, ten);
  check("no samples is no estimate", estimateFromSamples([]) === null);

  const file = path.join(TMP, "eta", "ai-eta-history.json");
  const key = `${"a".repeat(64)}|node-llama-cpp@3.21.1+llama.cpp@v0.4.0|cpu|cpu|ctx4096|kv:runtime-default|validationExplanation|out176@cpu8-ram16g-novram`;
  const store = new AiEtaHistoryStore(file, Date.now, () => undefined);
  check("an empty history has no estimate", (await store.estimate(key, true)) === null);
  check("a completed cold run is recorded", await store.record(key, true, 52_000));
  check("cold and warm are kept apart", (await store.estimate(key, true))?.samples === 1 && (await store.estimate(key, false)) === null);
  for (let i = 0; i < AI_ETA_HISTORY_LIMITS.samplesPerKey + 5; i += 1) await store.record(key, false, 10_000 + i * 1_000);
  const warm = (await store.entries()).get(key)?.warm ?? [];
  check("each list keeps only its newest samples", warm.length === AI_ETA_HISTORY_LIMITS.samplesPerKey && warm[0] === 15_000 && warm.at(-1) === 34_000, warm);
  check("a new store instance reads the same history (it survives a restart)", (await new AiEtaHistoryStore(file, Date.now, () => undefined).estimate(key, false))?.samples === AI_ETA_HISTORY_LIMITS.samplesPerKey);
  // The cap is what the FILE holds, cold and warm, not only what a read returns.
  const capFile = path.join(TMP, "eta-cap", "h.json");
  const capStore = new AiEtaHistoryStore(capFile, Date.now, () => undefined);
  const onDisk = () => (JSON.parse(fs.readFileSync(capFile, "utf8")) as { entries: Record<string, { cold: number[]; warm: number[] }> }).entries[key];
  // Each list is read from the file right after its own writes: a later write of the other list re-reads it trimmed.
  for (let i = 0; i < AI_ETA_HISTORY_LIMITS.samplesPerKey + 3; i += 1) await capStore.record(key, true, 50_000 + i);
  const coldOnDisk = onDisk()?.cold ?? [];
  for (let i = 0; i < AI_ETA_HISTORY_LIMITS.samplesPerKey + 3; i += 1) await capStore.record(key, false, 5_000 + i);
  const warmOnDisk = onDisk()?.warm ?? [];
  check(
    "the file itself keeps at most the newest samples per list, cold and warm",
    coldOnDisk.length === AI_ETA_HISTORY_LIMITS.samplesPerKey && warmOnDisk.length === AI_ETA_HISTORY_LIMITS.samplesPerKey && coldOnDisk[0] === 50_003 && warmOnDisk[0] === 5_003,
    { cold: coldOnDisk.length, warm: warmOnDisk.length }
  );

  for (const [label, badKey] of [
    ["a key with spaces (free text)", `Explain this: ${SECRET}`],
    ["a path", "C:\\Users\\someone\\model.gguf"],
    ["an empty key", ""]
  ] as const) {
    check(`${label} is refused`, (await store.record(badKey, true, 1_000)) === false);
  }
  for (const [label, ms] of [["zero", 0], ["negative", -5], ["not a number", Number.NaN], ["beyond any budget", AI_ETA_HISTORY_LIMITS.maxSampleMs + 1]] as const) {
    check(`a duration that is ${label} is refused`, (await store.record(key, true, ms)) === false);
  }
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as { schemaVersion: number; entries: Record<string, { cold: unknown[]; warm: unknown[]; updatedAt: string }> };
  check(
    "the file holds a version, latency-class ids, integer durations and timestamps only",
    parsed.schemaVersion === AI_ETA_HISTORY_VERSION &&
      Object.entries(parsed.entries).every(([k, v]) => /^[A-Za-z0-9._|:@+-]+$/.test(k) && [...v.cold, ...v.warm].every((n) => Number.isInteger(n)) && !Number.isNaN(Date.parse(v.updatedAt))) &&
      !raw.includes(SECRET),
    Object.keys(parsed.entries)
  );
  check("no temporary file is left beside it (tmp + rename)", fs.readdirSync(path.dirname(file)).every((name) => !name.endsWith(".tmp")));

  // A clock that stands still: every write in the same millisecond, the case LRU order cannot decide.
  const stillStore = new AiEtaHistoryStore(path.join(TMP, "eta-still", "h.json"), () => 1_700_000_000_000, () => undefined);
  const other = (i: number) => `${String(i).padStart(64, "0")}|b|cpu|cpu|ctx4096|kv|failureAnalysis|out256@hw`;
  for (let i = 0; i < AI_ETA_HISTORY_LIMITS.maxKeys + 6; i += 1) {
    await stillStore.record(other(i), true, 1_000 + i);
    if (!(await stillStore.entries()).has(other(i))) break;
  }
  const stillKeys = [...(await stillStore.entries()).keys()];
  check("at most maxKeys keys are kept, and the key just written always survives, even in one millisecond", stillKeys.length === AI_ETA_HISTORY_LIMITS.maxKeys && stillKeys.includes(other(AI_ETA_HISTORY_LIMITS.maxKeys + 5)), stillKeys.length);
  let tick = 0;
  const lruStore = new AiEtaHistoryStore(path.join(TMP, "eta-lru", "h.json"), () => 1_700_000_000_000 + (tick += 1_000), () => undefined);
  await lruStore.record(key, true, 5_000);
  for (let i = 0; i < AI_ETA_HISTORY_LIMITS.maxKeys; i += 1) await lruStore.record(other(i), true, 1_000 + i);
  const lruKeys = [...(await lruStore.entries()).keys()];
  check("the least recently updated key is the one dropped", lruKeys.length === AI_ETA_HISTORY_LIMITS.maxKeys && !lruKeys.includes(key) && lruKeys.includes(other(0)), lruKeys.length);

  const concurrent = new AiEtaHistoryStore(path.join(TMP, "eta-concurrent", "h.json"), Date.now, () => undefined);
  await Promise.all(Array.from({ length: 10 }, (_, i) => concurrent.record(key, true, 1_000 + i)));
  check("concurrent records are serialized: none is lost", (await concurrent.entries()).get(key)?.cold.length === 10);

  const newer = path.join(TMP, "eta-newer", "h.json");
  fs.mkdirSync(path.dirname(newer), { recursive: true });
  const future = JSON.stringify({ schemaVersion: AI_ETA_HISTORY_VERSION + 1, entries: { [key]: { cold: [5], warm: [], updatedAt: new Date().toISOString(), extra: "future" } } });
  fs.writeFileSync(newer, future);
  const newerStore = new AiEtaHistoryStore(newer, Date.now, () => undefined);
  check("a newer version's file is read as no history", (await newerStore.estimate(key, true)) === null);
  check("...and is never overwritten by this version", (await newerStore.record(key, true, 2_000)) === false && fs.readFileSync(newer, "utf8") === future);

  const corrupt = path.join(TMP, "eta-corrupt", "h.json");
  fs.mkdirSync(path.dirname(corrupt), { recursive: true });
  fs.writeFileSync(corrupt, "{ not json");
  const corruptStore = new AiEtaHistoryStore(corrupt, Date.now, () => undefined);
  check("a corrupt file reads as no history", (await corruptStore.estimate(key, true)) === null);
  check("...is preserved beside it, and a new history starts", fs.readdirSync(path.dirname(corrupt)).some((name) => name.startsWith("h.json.corrupt-")) && (await corruptStore.record(key, true, 3_000)));
  const forged = path.join(TMP, "eta-forged", "h.json");
  fs.mkdirSync(path.dirname(forged), { recursive: true });
  fs.writeFileSync(forged, JSON.stringify({ schemaVersion: 1, entries: { [key]: { cold: [1_000, -3, "x", 2.5, 2_000], warm: "nope", updatedAt: "yesterday" }, [`bad key ${SECRET}`]: { cold: [1], warm: [] } } }));
  const forgedEntries = await new AiEtaHistoryStore(forged, Date.now, () => undefined).entries();
  check(
    "a forged file keeps only well-formed durations under well-formed keys",
    forgedEntries.size === 1 && JSON.stringify(forgedEntries.get(key)?.cold) === "[1000,2000]" && forgedEntries.get(key)?.warm.length === 0,
    [...forgedEntries.entries()]
  );
}

// ── E. The model copy: determinate by bytes, cancellable ───────────────────────────────────────────
section("E. Model copy progress and cancel");
{
  const header = Buffer.alloc(8);
  header.write("GGUF", 0, "ascii");
  header.writeUInt32LE(3, 4);
  const source = path.join(TMP, "source-model.gguf");
  const size = 3 * 1024 * 1024 + 17;
  fs.writeFileSync(source, Buffer.concat([header, Buffer.alloc(size - header.length, 7)]));
  const dir = path.join(TMP, "copy-models");
  const pack = new AiModelPackStore(dir, [], Date.now, async () => 1e12);
  const seen: Array<[number, number]> = [];
  const copied = await pack.import(source, { onProgress: (done, total) => seen.push([done, total]) });
  check("a copy reports bytes against the file's own size", copied.ok && seen.length >= 2 && seen.every(([, total]) => total === size), seen.length);
  check("...rising to exactly the size, never past it", seen.every(([done], i) => i === 0 || done >= seen[i - 1][0]) && seen.at(-1)?.[0] === size && seen.every(([done]) => done <= size), seen.at(-1));
  await pack.remove();
  const controller = new AbortController();
  const aborted = await pack.import(source, { signal: controller.signal, onProgress: () => controller.abort() });
  check("a copy cancelled part-way ends ABORTED", !aborted.ok && aborted.code === "ABORTED", aborted);
  check("...keeping nothing: no model, no temp file, nothing registered", fs.readdirSync(dir).every((name) => name === "registry.json") && (await pack.status()).status === "missing", fs.readdirSync(dir));
  const early = new AbortController();
  early.abort();
  const before = await pack.import(source, { signal: early.signal });
  check("a copy cancelled before it starts copies nothing", !before.ok && before.code === "ABORTED" && (await pack.status()).status === "missing");
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nAI job status: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
