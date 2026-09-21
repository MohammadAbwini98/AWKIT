/**
 * verify:ai-deadlines — each product AI feature's own deadline, and the one limit they all live under
 * (Phase L, L1.8 follow-up).
 *
 * Features are driven through the product's own entry points with the production `AiService` and its
 * production limits, over the fake transport, which applies each call's deadline as the manager does.
 * A virtual clock (scripts/lib/virtual-clock.mts) runs the real timelines in milliseconds:
 *   - failure analysis through `analyzeFailure`, the function behind `ai:analyzeFailure`, over a report
 *     whose evidence and cause come from L5a's real buffer and baseline;
 *   - locator upgrade through `runLocatorUpgradeAttempts`, the L3 §7 job (nothing in the product queues it
 *     yet), with the browser proof stubbed as "page unavailable".
 * `verify:ai-authoring` §10 holds the validation explanation to its own deadline the same way.
 *
 * What makes it fail: a deadline that is not its feature's L1.8 ceiling plus 5 s; one the service would
 * refuse as INVALID_REQUEST; a real answer past the old shared 30 s cut off; a hung call not ended at
 * exactly its deadline, or not cancelled on the host; a locator job's second attempt sharing the first
 * one's deadline; a user cancel reported as a timeout; a late answer stored or reaching the next request;
 * a host killed at the deadline not reloaded; the fragment summary losing its 30 s.
 *
 * Run: npm run verify:ai-deadlines
 */
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AI_SERVICE_LIMITS, AiService } from "@src/ai/AiService";
import { AUTHORING_LIMITS } from "@src/ai/authoringExplanation";
import { AI_HOST_TIMEOUTS } from "@src/ai/contracts/AiHostProtocol";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { FAILURE_ANALYSIS_LIMITS } from "@src/ai/failureAnalysis";
import { FRAGMENT_ASSIST_LIMITS } from "@src/ai/fragmentAssist";
import { LOCATOR_ATTEMPT_LIMITS, runLocatorUpgradeAttempts, type LocatorAttemptResult } from "@src/ai/locatorUpgradeAttempts";
import type { FlowStep, PendingLocatorUpgrade, StepLocator } from "@src/profiles/FlowProfile";
import { sanitizeUpgradeContext } from "@src/recorder/upgradeContext";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { EvidenceBuffer, EvidenceRunBudget } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION } from "@src/runner/evidence/FailureEvidenceCollector";
import type { LocatorProofResult } from "@src/runner/locatorProof";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { analyzeFailure, assistJobId, cancelAssist } from "../app/main/ai/aiAssist";
import { virtualClock } from "./lib/virtual-clock.mts";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const MODEL_ROOT = resolvePath(join(tmpdir(), "awkit-ai-deadlines-models"));
const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "healthy", dispatchBlocked: false, activeWeight: 0, weightedBudget: 4, freeMemoryMb: 8_000 };
const POLICY = { enabled: true, featureTiers: {} } as const;

/** The production `AiService`, production limits, over a fake transport answering the script in order. */
function harness(script: Array<FakeInferStep | string>) {
  const fake = new FakeAiHostTransport({ modelRoot: MODEL_ROOT, respond: (_request, index) => script[Math.min(index, script.length - 1)] ?? "{}" });
  const service = new AiService({
    transport: () => fake,
    model: async () => ({ ok: true, modelId: "fake-deadline-model", modelPath: join(MODEL_ROOT, "model.gguf"), contextTokens: 8192 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => IDLE,
    threads: 2,
    limits: AI_SERVICE_LIMITS,
    nonce: () => "0123456789abcdef"
  });
  return { fake, service };
}
type Harness = ReturnType<typeof harness>;

const clock = virtualClock();
const { settle } = clock;
/** Far past any deadline here, so a wrong deadline shows as a wrong outcome, never as work left pending. */
const BUDGET_MS = 15 * 60_000;
const OLD_DEADLINE_MS = 30_000;
/** Measured beside the product's requests (L1.8): wall minus prompt and generation ≤ 41 ms, main-loop delay ≤ 61 ms. */
const MEASURED_OVERHEAD_MS = 41 + 61;
/** The L1.8 ceilings in scripts/benchmark-ai-model.mts: `explanationAtCapMs` and `backgroundJobAtCapMs`. */
const EXPLANATION_CEILING_MS = 120_000;
const BACKGROUND_CEILING_MS = 180_000;
const counters = async (h: Harness) => (await h.service.status()).counters;
/** Shutdown waits on timers too: off the clock it would never return. */
const stop = (h: Harness) => settle(h.service.shutdown(), BUDGET_MS);
const brief = (value: unknown) => JSON.stringify(value)?.slice(0, 240);
const cancelledOnHost = (h: Harness, jobPrefix: string) => h.fake.requests.some((r) => r.type === "cancel" && r.jobId.startsWith(jobPrefix));

// ── 0. Every feature's deadline, and the one limit they live under ──────────────────────────────
console.log("\n0 — each feature's own deadline");
const DEADLINES = [
  { feature: "validationExplanation", ms: AUTHORING_LIMITS.timeoutMs, ceiling: EXPLANATION_CEILING_MS },
  { feature: "failureAnalysis", ms: FAILURE_ANALYSIS_LIMITS.timeoutMs, ceiling: BACKGROUND_CEILING_MS },
  { feature: "locatorAttempt", ms: LOCATOR_ATTEMPT_LIMITS.timeoutMs, ceiling: BACKGROUND_CEILING_MS },
  { feature: "fragmentSummary", ms: FRAGMENT_ASSIST_LIMITS.timeoutMs, ceiling: null }
] as const;
for (const { feature, ms, ceiling } of DEADLINES) {
  if (ceiling === null) check(`${feature} has no L1.8 ceiling of its own and keeps the shared 30 s`, ms === OLD_DEADLINE_MS, String(ms));
  else check(`${feature}: its L1.8 ceiling (${ceiling / 1000} s at the output cap) plus a 5 s allowance`, ms === ceiling + 5_000, String(ms));
}
check(
  "the service accepts every one of the four deadlines: a longer one is refused as an invalid request",
  DEADLINES.length === 4 && DEADLINES.every(({ ms }) => ms <= AI_SERVICE_LIMITS.maxJobTimeoutMs),
  JSON.stringify(DEADLINES.map(({ feature, ms }) => [feature, ms]))
);
check(
  "...and its limit is the longest of them, not a free extension beyond every feature",
  AI_SERVICE_LIMITS.maxJobTimeoutMs === Math.max(...DEADLINES.map(({ ms }) => ms)),
  String(AI_SERVICE_LIMITS.maxJobTimeoutMs)
);

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** A stored report whose failed instance carries L5a's real evidence buffer and cause baseline. */
function failedRun(executionId: string): ConcurrentRunReport & { id: string } {
  const instanceId = `${executionId}-row1`;
  let at = 0;
  const buffer = new EvidenceBuffer({ executionId, instanceId }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => at });
  const context = { flowId: "flow-checkout", nodeId: "n-submit", stepIndex: 2 };
  at = 1_000;
  buffer.add({ source: "http.error", severity: "error", context, payload: { method: "POST", url: "https://shop.example/orders/40001/submit", status: 500, resourceType: "xhr" } });
  at = 1_500;
  buffer.add({ source: "runner.failure", severity: "error", context, payload: { kind: "assertion", message: "The order confirmation did not appear." } });
  const evidence = [...buffer.list()];
  const runner = evidence.find((event) => event.source === "runner.failure");
  const cause = deriveFailureCause(evidence, { kind: "assertion", stepStartOffsetMs: 500, failedAtOffsetMs: 1_500, ...(runner ? { evidenceId: runner.id } : {}) });
  return {
    id: executionId,
    executionId,
    scenarioId: "wf-checkout",
    scenarioName: "Checkout",
    runMode: "dataDrivenConcurrent",
    maxConcurrentInstances: 1,
    status: "failed",
    startedAt: "2026-09-21T09:00:00.000Z",
    endedAt: "2026-09-21T09:00:01.500Z",
    durationMs: 1_500,
    passedFlows: 0,
    failedFlows: 1,
    skippedFlows: 0,
    instances: [
      {
        instanceId,
        status: "failed",
        durationMs: 1_500,
        error: "The order confirmation did not appear.",
        screenshots: [],
        downloadedFiles: [],
        diagnostics: { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence, summary: buffer.summary(), cause }
      }
    ],
    runtimeInputs: {}
  } as ConcurrentRunReport & { id: string };
}

const WINDOW = 7;
const run = failedRun("exec-deadline");
const instanceId = run.instances[0].instanceId;
const primaryId = run.instances[0].diagnostics!.cause!.evidenceIds[0];
const analysis = (marker: string) =>
  JSON.stringify({ version: 1, insufficient: false, category: "server error", explanation: `${marker}: the order submit request failed with a server error.`, primaryEvidenceIds: [primaryId], investigationSteps: ["Check the order service."] });

/** `analyzeFailure` over an in-memory report store, as `ai.ipc.ts` wires it over the real one. */
function analyzeWith(h: Harness, requestId: string, store: Map<string, ConcurrentRunReport>) {
  if (!store.has(run.executionId)) store.set(run.executionId, structuredClone(run));
  return analyzeFailure(WINDOW, { requestId, executionId: run.executionId, instanceId }, {
    submit: (job) => h.service.submit(job),
    policy: async () => POLICY,
    report: async (executionId) => store.get(executionId) ?? null,
    updateReport: async (executionId, change) => {
      const next = change(store.get(executionId) ?? null);
      if (next) store.set(executionId, next);
      return next;
    }
  });
}
const savedAnalyses = (store: Map<string, ConcurrentRunReport>) => store.get(run.executionId)?.diagnostics?.analyses?.length ?? 0;

/** A guarded-positional baseline, the weak class L3 §1 queues a job for. */
const GUARDED: StepLocator = {
  strategy: "css",
  value: ".row > button",
  quality: { strategy: "fallback", isUnique: false, matchCount: 3, confidence: "low", disambiguation: "positional" },
  guard: {
    container: [],
    candidateSelector: ".row > button",
    siblingCount: 3,
    index: 1,
    confidence: "high",
    fingerprint: { tag: "button", role: "button", name: "aaaa", text: "bbbb", attributes: {}, ancestry: ["cccc"] }
  }
};
const WEAK_STEP = { id: "s-archive", type: "click", name: "Archive item", locator: GUARDED } as FlowStep;
const PLAN = '{"version":1,"target":{"strategy":"role","value":"button","name":"Archive","exact":true},"scopes":[]}';
const POSITIONAL_PLAN = '{"version":1,"target":{"strategy":"css","value":"button:nth-child(2)"},"scopes":[]}';
const PAGE_UNAVAILABLE: LocatorProofResult = {
  schemaVersion: 1,
  outcome: "unprovable-now",
  code: "PAGE_UNAVAILABLE",
  compiled: true,
  intent: "passed",
  gates: { policy: "not-run", buildable: "not-run", unique: "not-run", sameElement: "not-run" },
  scope: "compatible",
  pendingEligible: true
};

/** One L3 §7 job, wired as a production caller wires it; every stored proposal is kept. */
function upgradeWith(h: Harness, requestId: string, stored: PendingLocatorUpgrade[], signal?: AbortSignal): Promise<LocatorAttemptResult> {
  const upgradeContext = sanitizeUpgradeContext(
    {
      target: { tag: "button", role: "button", name: "Archive", type: "" },
      candidates: [{ strategy: "role", value: "button", name: "Archive", count: 2, fallback: false }],
      containers: [{ kind: "card", tag: "section", role: "region", name: "Guarded baselines" }],
      heading: "Locator Upgrade Lab",
      siblingActions: ["Remove", "Swap twins"],
      pageKey: "/recorder-lab/locator-upgrade"
    },
    { pageAlias: "main", frameDepth: 0 }
  );
  return runLocatorUpgradeAttempts(
    { requestId, step: WEAK_STEP, boundValues: ["Alice Smith"], upgradeContext, ...(signal ? { signal } : {}) },
    {
      ai: h.service,
      prove: async () => PAGE_UNAVAILABLE,
      annotate: async (pending) => {
        stored.push(pending);
        return { code: "OK" };
      }
    }
  );
}

clock.install();
try {
  // ── 1. Failure analysis ───────────────────────────────────────────────────────────────────────
  console.log("\n1 — failure analysis, through analyzeFailure");
  const FA = FAILURE_ANALYSIS_LIMITS.timeoutMs;

  const late = harness([{ text: analysis("LATE-OK"), delayMs: OLD_DEADLINE_MS + 1_000 }]);
  const lateStore = new Map<string, ConcurrentRunReport>();
  const lateStarted = clock.now();
  const lateView = await settle(analyzeWith(late, "fa-late", lateStore), BUDGET_MS);
  check("an analysis arriving after the old 30 s deadline is delivered", lateView?.value.ok === true && lateView.value.analysis !== null, brief(lateView?.value));
  check("...when it arrived, 31 s in: the clock really ran", (lateView?.atMs ?? 0) - lateStarted >= OLD_DEADLINE_MS + 1_000, String((lateView?.atMs ?? 0) - lateStarted));
  check("...and saved with the run's report", lateView?.value.stored === true && savedAnalyses(lateStore) === 1, String(savedAnalyses(lateStore)));
  await stop(late);

  const edge = harness([{ text: analysis("EDGE-OK"), delayMs: BACKGROUND_CEILING_MS + MEASURED_OVERHEAD_MS }]);
  const edgeView = await settle(analyzeWith(edge, "fa-edge", new Map()), BUDGET_MS);
  check("an analysis at the 180 s ceiling plus the measured overhead is delivered", edgeView?.value.ok === true, brief(edgeView?.value));
  await stop(edge);

  const hung = harness([{ hang: true }]);
  const hungStore = new Map<string, ConcurrentRunReport>();
  const hungStarted = clock.now();
  const hungView = await settle(analyzeWith(hung, "fa-hang", hungStore), BUDGET_MS);
  const hungMs = (hungView?.atMs ?? 0) - hungStarted;
  check("an analysis that never comes fails TIMEOUT", hungView?.value.code === "TIMEOUT", brief(hungView?.value));
  check("...at the feature's own deadline, not the old 30 s", hungMs >= FA && hungMs <= FA + AI_HOST_TIMEOUTS.cancelMs, `${hungMs} ms`);
  check("...saying so in a product sentence", hungView?.value.message === "Local AI took too long to answer.");
  check("...with the inference cancelled on the host", cancelledOnHost(hung, `${assistJobId(WINDOW, "fa-hang")}#`));
  check("...and nothing saved with the report", savedAnalyses(hungStore) === 0);
  await stop(hung);

  const waiting = harness([{ hang: true }]);
  let waitingDone = false;
  const waitingPending = analyzeWith(waiting, "fa-cancel", new Map()).then((view) => ((waitingDone = true), view));
  await clock.run(clock.now() + 2 * OLD_DEADLINE_MS);
  check("(precondition) 60 s in, the analysis is still running rather than timed out", !waitingDone && (await waiting.service.status()).state.kind === "busy");
  const cancelledAt = clock.now();
  check("the asking window cancels it", cancelAssist(WINDOW, "fa-cancel", (id) => waiting.service.cancel(id)).ok);
  const cancelled = await settle(waitingPending, BUDGET_MS);
  check("...and it answers CANCELLED, not TIMEOUT, promptly", cancelled?.value.code === "CANCELLED" && cancelled.atMs - cancelledAt <= AI_HOST_TIMEOUTS.cancelMs, brief(cancelled?.value));
  await clock.run(clock.now() + FA);
  const waitingCounters = await counters(waiting);
  check("...counted once as a cancel; its deadline passing later adds nothing", waitingCounters.cancelled === 1 && waitingCounters.failed === 0 && waitingCounters.completed === 0, JSON.stringify(waitingCounters));
  await stop(waiting);

  const overdue = harness([{ text: analysis("STALE"), delayMs: FA + 5_000 }, analysis("FRESH")]);
  const overdueStore = new Map<string, ConcurrentRunReport>();
  const overdueView = await settle(analyzeWith(overdue, "fa-overdue", overdueStore), BUDGET_MS);
  check("an analysis due after the deadline is not waited for: TIMEOUT", overdueView?.value.code === "TIMEOUT", brief(overdueView?.value));
  await clock.run(clock.now() + 30_000);
  const overdueCounters = await counters(overdue);
  check("...counted once, as a failure: nothing completes when it was due", overdueCounters.failed === 1 && overdueCounters.completed === 0, JSON.stringify(overdueCounters));
  check("...and nothing of it is saved with the report, then or later", savedAnalyses(overdueStore) === 0);
  const fresh = await settle(analyzeWith(overdue, "fa-after-overdue", overdueStore), BUDGET_MS);
  check(
    "the next analysis gets its own answer, never the late one",
    fresh?.value.ok === true && /^FRESH:/.test(fresh.value.analysis?.explanation ?? "") && !JSON.stringify(overdueStore.get(run.executionId)).includes("STALE"),
    brief(fresh?.value)
  );
  await stop(overdue);

  const stuck = harness([{ hang: true, killOnCancel: true }, analysis("RELOADED")]);
  const stuckView = await settle(analyzeWith(stuck, "fa-kill", new Map()), BUDGET_MS);
  check("a model stuck in prompt evaluation at the deadline still ends TIMEOUT", stuckView?.value.code === "TIMEOUT", brief(stuckView?.value));
  check("(precondition) the host was killed to free it, not crashed", stuck.fake.kills === 1 && stuck.fake.crashes === 0, `kills ${stuck.fake.kills}, crashes ${stuck.fake.crashes}`);
  const reloaded = await settle(analyzeWith(stuck, "fa-kill-next", new Map()), BUDGET_MS);
  check("the next analysis is answered after a fresh handshake and model reload", reloaded?.value.ok === true && stuck.fake.requestTypes().join(",") === "hello,load,infer,cancel,hello,load,infer", stuck.fake.requestTypes().join(","));
  await stop(stuck);

  // ── 2. Locator upgrade ────────────────────────────────────────────────────────────────────────
  console.log("\n2 — locator upgrade, through the L3 §7 job");
  const LA = LOCATOR_ATTEMPT_LIMITS.timeoutMs;

  const slowPlan = harness([{ text: PLAN, delayMs: OLD_DEADLINE_MS + 1_000 }]);
  const slowStored: PendingLocatorUpgrade[] = [];
  const slowJob = await settle(upgradeWith(slowPlan, "lu-late", slowStored), BUDGET_MS);
  check("a plan arriving after the old 30 s deadline is accepted", slowJob?.value.outcome === "accepted" && slowStored.length === 1, brief(slowJob?.value));
  check("...on its first attempt", slowJob?.value.calls === 1 && slowJob.value.attemptsUsed === 0);
  await stop(slowPlan);

  const edgePlan = harness([{ text: PLAN, delayMs: BACKGROUND_CEILING_MS + MEASURED_OVERHEAD_MS }]);
  const edgeJob = await settle(upgradeWith(edgePlan, "lu-edge", []), BUDGET_MS);
  check("a plan at the 180 s ceiling plus the measured overhead is accepted", edgeJob?.value.outcome === "accepted", brief(edgeJob?.value));
  await stop(edgePlan);

  const hungPlan = harness([{ hang: true }]);
  const hungStored: PendingLocatorUpgrade[] = [];
  const hungJobStarted = clock.now();
  const hungJob = await settle(upgradeWith(hungPlan, "lu-hang", hungStored), BUDGET_MS);
  const hungJobMs = (hungJob?.atMs ?? 0) - hungJobStarted;
  check("a provider that never answers ends the job TIMEOUT", hungJob?.value.outcome === "provider-unavailable" && hungJob.value.code === "TIMEOUT", brief(hungJob?.value));
  check("...at the feature's own deadline, not the old 30 s", hungJobMs >= LA && hungJobMs <= LA + AI_HOST_TIMEOUTS.cancelMs, `${hungJobMs} ms`);
  check("...spending no synthesis attempt, with the inference cancelled on the host and nothing stored", hungJob?.value.attemptsUsed === 0 && cancelledOnHost(hungPlan, "lu-hang.a1#") && hungStored.length === 0);
  await stop(hungPlan);

  // A refused first attempt answered at 100 s: the second gets a whole deadline of its own.
  const second = harness([{ text: POSITIONAL_PLAN, delayMs: 100_000 }, { hang: true }]);
  const secondStarted = clock.now();
  const secondJob = await settle(upgradeWith(second, "lu-second", []), BUDGET_MS);
  const secondMs = (secondJob?.atMs ?? 0) - secondStarted;
  check("(precondition) the first attempt was refused and spent", secondJob?.value.attempts[0]?.code === "POSITIONAL" && secondJob.value.calls === 2, brief(secondJob?.value));
  check("the deadline is per attempt: a hung second attempt ends a full deadline after the first answer", secondJob?.value.code === "TIMEOUT" && secondMs >= 100_000 + LA && secondMs <= 100_000 + LA + AI_HOST_TIMEOUTS.cancelMs, `${secondMs} ms`);
  await stop(second);

  const aborted = harness([{ hang: true }]);
  const abortedStored: PendingLocatorUpgrade[] = [];
  const controller = new AbortController();
  let abortedDone = false;
  const abortedPending = upgradeWith(aborted, "lu-cancel", abortedStored, controller.signal).then((result) => ((abortedDone = true), result));
  await clock.run(clock.now() + 2 * OLD_DEADLINE_MS);
  check("(precondition) 60 s in, the job is still waiting rather than timed out", !abortedDone);
  const abortedAt = clock.now();
  controller.abort();
  const abortedJob = await settle(abortedPending, BUDGET_MS);
  check("a cancelled job ends cancelled, not TIMEOUT, promptly", abortedJob?.value.outcome === "cancelled" && abortedJob.atMs - abortedAt <= AI_HOST_TIMEOUTS.cancelMs, brief(abortedJob?.value));
  check("...with nothing stored", abortedStored.length === 0);
  await stop(aborted);

  const overduePlan = harness([{ text: PLAN, delayMs: LA + 5_000 }, PLAN]);
  const overdueStored: PendingLocatorUpgrade[] = [];
  const overdueJob = await settle(upgradeWith(overduePlan, "lu-overdue", overdueStored), BUDGET_MS);
  check("a plan due after the deadline is not waited for: TIMEOUT", overdueJob?.value.code === "TIMEOUT", brief(overdueJob?.value));
  await clock.run(clock.now() + 30_000);
  check("...and nothing is stored when it was due", overdueStored.length === 0 && (await counters(overduePlan)).completed === 0);
  await stop(overduePlan);

  const stuckPlan = harness([{ hang: true, killOnCancel: true }, PLAN]);
  const stuckJob = await settle(upgradeWith(stuckPlan, "lu-kill", []), BUDGET_MS);
  check("a model stuck in prompt evaluation at the deadline still ends the job TIMEOUT", stuckJob?.value.code === "TIMEOUT" && stuckPlan.fake.kills === 1, brief(stuckJob?.value));
  const nextJob = await settle(upgradeWith(stuckPlan, "lu-kill-next", []), BUDGET_MS);
  check("the next job is accepted after a fresh handshake and model reload", nextJob?.value.outcome === "accepted" && stuckPlan.fake.requestTypes().join(",") === "hello,load,infer,cancel,hello,load,infer", stuckPlan.fake.requestTypes().join(","));
  await stop(stuckPlan);
} finally {
  clock.uninstall();
}

console.log(`\nAI deadlines: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
