/**
 * Two product AI requests on the real model, each sent by the product's own code under its own
 * deadline (Phase L, L1.8 follow-up), run inside the AI harness (scripts/ai-harness/harnessMain.ts):
 *
 *   failureAnalysis  L5b through `analyzeFailure`, the function behind `ai:analyzeFailure`, over a run
 *                    report whose evidence and cause come from L5a's real buffer and baseline. Each
 *                    answer must be ACCEPTED and classified as its fixture requires — a conclusion
 *                    for the typical and the largest failure, insufficient for a bare runner timeout.
 *                    Arriving in time is not enough: every real v1 answer arrived and was refused.
 *   locatorUpgrade   L3 §7 through `runLocatorUpgradeAttempts`, the job the product will queue once L1
 *                    is accepted (nothing queues it yet), over a capture context bounded by L2's own
 *                    `sanitizeUpgradeContext`. The browser proof is stubbed as "page unavailable": it
 *                    runs after the model answers and is not part of any deadline.
 *
 * Each runs a typical request and the largest one the product builds. The benchmark measured synthetic
 * stand-ins for both features, at output caps the product does not use, so this is what the product's
 * deadline has to cover. Counts, codes and timings only, never model text.
 */

import os from "node:os";

import { analyzeFailure } from "@main/ai/aiAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import type { AiJobOutcome, AiJobRequest } from "@src/ai/AiService";
import { AI_HOST_PROTOCOL_VERSION, type AiHostHello } from "@src/ai/contracts/AiHostProtocol";
import { FAILURE_ANALYSIS_LIMITS, parseFailureAnalysis, redactFailureAnalysis } from "@src/ai/failureAnalysis";
import { LOCATOR_ATTEMPT_LIMITS, runLocatorUpgradeAttempts } from "@src/ai/locatorUpgradeAttempts";
import type { FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { markBoundValues, sanitizeUpgradeContext } from "@src/recorder/upgradeContext";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { RunnerFailureKind } from "@src/runner/evidence/FailureCauseBaseline";
import type { LocatorProofResult } from "@src/runner/locatorProof";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { LARGEST_FAILURE, RUNNER_ONLY_FAILURE, TYPICAL_FAILURE, answerShape, failedRun, productFailureRequest, type FixtureEvent } from "./failureAnalysisPacket";
import type { LiveContext } from "./harnessMain";

export interface FeatureLiveApi {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
  makeLiveContext: () => LiveContext;
}

const HELLO = { type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } } as const;
/** Synthesis failures: the model answered in time, and the output contract refused what it said. */
const ANSWERED = new Set(["MALFORMED_OUTPUT", "SCHEMA_REJECTED"]);

/** A live context whose job outcomes, and the deadline the manager gave each inference, are kept. */
function observed(api: FeatureLiveApi) {
  const ctx = api.makeLiveContext();
  const deadlines: number[] = [];
  const call = ctx.manager.call.bind(ctx.manager);
  ctx.manager.call = ((request: Parameters<typeof call>[0], timeoutMs: number) => {
    if (request.type === "infer") deadlines.push(timeoutMs);
    return call(request, timeoutMs);
  }) as typeof ctx.manager.call;
  const jobs: Array<{ request: AiJobRequest; outcome: AiJobOutcome }> = [];
  const submit = async (request: AiJobRequest): Promise<AiJobOutcome> => {
    const outcome = await ctx.service.submit(request);
    jobs.push({ request, outcome });
    return outcome;
  };
  return { ...ctx, deadlines, jobs, submit };
}

/** One answer's counts and timings, and the L1.8 worst case: its prompt time plus the request's own output cap. */
function measured(outcome: AiJobOutcome, maxOutputTokens: number) {
  if (outcome.status !== "ok") return { status: outcome.status, ...("code" in outcome ? { code: outcome.code } : {}) };
  const { promptTokens, outputTokens, firstTokenMs, generationMs } = outcome.usage;
  const rate = outputTokens > 1 && generationMs > 0 ? (outputTokens - 1) / (generationMs / 1000) : null;
  return {
    status: outcome.status,
    promptTokens,
    outputTokens,
    firstTokenMs,
    generationMs,
    inferMs: firstTokenMs + generationMs,
    generationTokensPerSec: rate === null ? null : +rate.toFixed(2),
    atOutputCapMs: rate === null ? null : Math.round(firstTokenMs + (maxOutputTokens / rate) * 1000)
  };
}

/** Delivered, or refused on its content: either way the model answered before the deadline. */
function answeredInTime(outcome: AiJobOutcome | undefined): boolean {
  return outcome?.status === "ok" || (outcome?.status === "failed" && ANSWERED.has(outcome.code));
}

/**
 * System-wide CPU busy share over `ms`, taken before any inference. Timings on this laptop vary between
 * runs; this separates "another process holds the CPU" from "the CPU itself is slower right now".
 */
async function hostBusyPct(ms = 3_000): Promise<number> {
  const totals = () =>
    os.cpus().reduce(
      (sum, cpu) => ({ idle: sum.idle + cpu.times.idle, all: sum.all + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq }),
      { idle: 0, all: 0 }
    );
  const before = totals();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = totals();
  const all = after.all - before.all;
  return all > 0 ? Math.round((1 - (after.idle - before.idle) / all) * 100) : 0;
}

async function hello(api: FeatureLiveApi, ctx: LiveContext): Promise<void> {
  await api.step("the host reports a compatible runtime", async () => {
    const answer = await ctx.manager.call<AiHostHello>(HELLO, 15_000);
    if (!answer.compatible) throw new Error(`incompatible: ${JSON.stringify(answer.runtime)}`);
    return { ...answer.runtime, hostBusyPctBeforeInference: await hostBusyPct() };
  });
}

// ── failureAnalysis ──────────────────────────────────────────────────────────────────────────────
// The fixtures live in failureAnalysisPacket.ts, which `benchmark:ai-model` also measures.

export async function runFailureAnalysisLive(api: FeatureLiveApi): Promise<void> {
  const ctx = observed(api);
  const reports = new Map<string, ConcurrentRunReport>();
  const deps = {
    submit: ctx.submit,
    policy: async () => ({ enabled: true, featureTiers: {} }),
    report: async (executionId: string) => reports.get(executionId) ?? null,
    updateReport: async (executionId: string, change: (current: ConcurrentRunReport | null) => ConcurrentRunReport | undefined) => {
      const next = change(reports.get(executionId) ?? null);
      if (next) reports.set(executionId, next);
      return next;
    }
  };
  api.record("deadlineMs", FAILURE_ANALYSIS_LIMITS.timeoutMs);
  await hello(api, ctx);

  /** `citesCause`: the conclusion must cite the event the deterministic cause rests on, not only the symptom. */
  const analyse = async (label: string, executionId: string, events: FixtureEvent[], kind: RunnerFailureKind, expect: "conclusion" | "insufficient", citesCause = false) =>
    api.step(label, async () => {
      const report = failedRun(executionId, events, kind);
      reports.set(executionId, report);
      const causeId = report.instances[0].diagnostics?.cause?.evidenceIds[0];
      const before = ctx.jobs.length;
      const started = Date.now();
      const view = await analyzeFailure(1, { requestId: `live-${executionId}`, executionId, instanceId: report.instances[0].instanceId }, deps);
      const elapsedMs = Date.now() - started;
      const job = ctx.jobs[before];
      if (!job) throw new Error(`no model call was made: ${view.code}`);
      // The request `analyzeFailure` built, rebuilt from the same report: the parser needs its evidence
      // and its tier. Proven the same by its prompt and schema, which carry both.
      const rebuilt = productFailureRequest(report);
      if (JSON.stringify([rebuilt.prompt, rebuilt.schema]) !== JSON.stringify([job.request.prompt, job.request.schema])) throw new Error("the rebuilt request is not the one the product sent");
      // Which offered evidence ids have their WHOLE line in the prompt the product actually sends. A prefix
      // is not enough: the old 1,200-character field cap sent the largest failure's `ev8` as a stub.
      const prompt = buildAiPrompt(job.request.prompt, new SemanticRedactor(), "0123456789abcdef");
      const offered = rebuilt.evidence.map((event) => event.id);
      const builtLines = rebuilt.prompt.fields.flatMap((field) => field.text?.split("\n") ?? []);
      const shownWhole = (id: string) => prompt.ok && builtLines.some((line) => line.startsWith(`${id}: `) && prompt.user.includes(`\n${line}`));
      // The view says only OUTPUT_REJECTED; the product's own parser says why, as a code and a field path.
      const verdict = (() => {
        if (job.outcome.status !== "ok") return null;
        const parsed = parseFailureAnalysis(job.outcome.value, rebuilt);
        if (!parsed.ok) return { refused: parsed.code, field: parsed.field };
        const { insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps } = parsed;
        const clean = redactFailureAnalysis({ insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps }, new SemanticRedactor());
        return clean ? { accepted: true } : { refused: "RESIDUAL_SECRET" };
      })();
      // Its keys show the grammar wrote every one.
      const shape = job.outcome.status === "ok" ? answerShape(job.outcome.value) : null;
      const analysis = view.analysis;
      const result = {
        code: view.code,
        verdict,
        shape,
        classified: analysis === null ? null : analysis.insufficient ? "insufficient" : "conclusion",
        expected: expect,
        // What the evidence let the grammar decode: decided by the product, not the model.
        decodable: rebuilt.mustConclude ? "conclusion" : rebuilt.evidence.some((event) => event.source !== "runner.failure") ? "either" : "insufficient",
        stored: view.stored === true,
        cited: analysis?.primaryEvidenceIds.length ?? 0,
        citesCause: causeId !== undefined && analysis !== null && analysis.primaryEvidenceIds.includes(causeId),
        evidenceOffered: offered.length,
        evidenceShownWhole: offered.filter(shownWhole).length,
        omittedFields: prompt.ok ? prompt.omittedFields : null,
        hostDeadlineMs: ctx.deadlines[ctx.deadlines.length - 1] ?? null,
        elapsedMs,
        ...measured(job.outcome, job.request.maxOutputTokens)
      };
      if (result.hostDeadlineMs !== FAILURE_ANALYSIS_LIMITS.timeoutMs) throw new Error(`the inference was given ${result.hostDeadlineMs} ms, not ${FAILURE_ANALYSIS_LIMITS.timeoutMs}`);
      if (result.evidenceShownWhole !== result.evidenceOffered) throw new Error(`the grammar offered evidence the model was not shown whole: ${JSON.stringify(result)}`);
      // Delivered, accepted, saved and classified as the fixture requires. Arriving is not enough, and
      // neither is parsing: every real v1 answer did both, and none was accepted.
      if (view.code !== "OK" || result.classified !== expect || !result.stored || (citesCause && !result.citesCause)) throw new Error(JSON.stringify(result));
      return result;
    });
  await analyse("a typical failure gets an accepted conclusion citing its cause, before its own deadline (after the model load)", "exec-live-typical", TYPICAL_FAILURE, "assertion", "conclusion", true);
  await analyse("a failure whose only evidence is the runner's own timeout is answered insufficient", "exec-live-runner-only", RUNNER_ONLY_FAILURE, "timeout", "insufficient");
  await analyse("the largest failure the product sends gets an accepted conclusion before its own deadline", "exec-live-largest", LARGEST_FAILURE, "timeout", "conclusion");
  await ctx.service.shutdown();
  api.record("counters", (await ctx.service.status()).counters);
}

// ── locatorUpgrade ───────────────────────────────────────────────────────────────────────────────

/** A guarded-positional baseline: the weak class L3 §1 queues a job for. */
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
const BOUND_VALUES = ["Alice Smith", "Bob Jones"];

/** What L3 §7's verifier captures on the Feature Test Lab's locator-upgrade page. */
const TYPICAL_CONTEXT = {
  target: { tag: "button", role: "button", name: "Archive", type: "" },
  candidates: [{ strategy: "role", value: "button", name: "Archive", count: 2, fallback: false }],
  containers: [{ kind: "card", tag: "section", role: "region", name: "Guarded baselines" }],
  heading: "Locator Upgrade Lab",
  siblingActions: ["Remove", "Swap twins"],
  pageKey: "/recorder-lab/locator-upgrade"
};

const text = (seed: string, length: number): string => seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

/** Every field at L2's own caps: five candidates, six containers, six sibling actions, 80-character texts. */
const LARGEST_CONTEXT = {
  target: { tag: "button", role: "button", name: text("Archive the selected customer order and notify the account owner ", 80), type: "button" },
  candidates: [
    { strategy: "role", value: "button", name: text("Archive the selected customer order and notify the account owner ", 80), count: 3, fallback: false },
    { strategy: "text", value: text("Archive the selected customer order and notify the account owner ", 200), count: 3, fallback: false },
    { strategy: "testId", value: text("orders-table-row-actions-archive-button-", 200), count: 2, fallback: false },
    { strategy: "css", value: text("main#content > section.orders-panel > div.table-wrapper > table.orders > tbody > tr.order-row > td.actions > ", 200), count: 3, fallback: true },
    { strategy: "xpath", value: text("//main[@id='content']/section[contains(@class,'orders-panel')]/div/table/tbody/tr/td[last()]/", 200), count: 3, fallback: true }
  ],
  containers: [
    { kind: "row", tag: "tr", role: "row", name: text("Order 40001 placed by Alice Smith on 21 September, awaiting fulfilment ", 80) },
    { kind: "form", tag: "form", role: "form", name: text("Bulk order actions for the selected rows in the current filtered view ", 80) },
    { kind: "card", tag: "section", role: "region", name: text("Open orders across every warehouse and every sales channel this week ", 80) },
    { kind: "dialog", tag: "div", role: "dialog", name: text("Review the orders you are about to archive before you confirm the change ", 80) },
    { kind: "landmark", tag: "main", role: "main", name: text("Order management workspace for the regional fulfilment operations team ", 80) },
    { kind: "listItem", tag: "li", role: "listitem", name: text("Saved view: open orders older than seven days with a pending payment ", 80) }
  ],
  heading: text("Open orders awaiting fulfilment across all warehouses and sales channels ", 80),
  siblingActions: [
    text("Mark the selected order as shipped and email the tracking link ", 60),
    text("Duplicate this order into a new draft for the same customer ", 60),
    text("Print the packing slip and the shipping label for this order ", 60),
    text("Refund the remaining balance to the original payment method ", 60),
    text("Assign this order to another fulfilment agent in the team ", 60),
    text("Open the full order history and every note left by support ", 60)
  ],
  pageKey: "/orders/open"
};

/** "Page unavailable", as `proveLocatorPlan` answers when the page has gone: stored for replay to settle. */
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

export async function runLocatorUpgradeLive(api: FeatureLiveApi): Promise<void> {
  const ctx = observed(api);
  api.record("deadlineMs", LOCATOR_ATTEMPT_LIMITS.timeoutMs);
  await hello(api, ctx);

  const upgrade = async (label: string, requestId: string, raw: unknown) =>
    api.step(label, async () => {
      const captured = sanitizeUpgradeContext(raw, { pageAlias: "main", frameDepth: 0 });
      if (!captured) throw new Error("the capture context did not sanitize");
      const upgradeContext = markBoundValues(captured, BOUND_VALUES.map((value) => value.toLowerCase()));
      const before = ctx.jobs.length;
      const deadlinesBefore = ctx.deadlines.length;
      const started = Date.now();
      const result = await runLocatorUpgradeAttempts(
        { requestId, step: WEAK_STEP, boundValues: BOUND_VALUES, upgradeContext },
        { ai: { submit: ctx.submit, cancel: (id) => ctx.service.cancel(id) }, prove: async () => PAGE_UNAVAILABLE, annotate: async () => ({ code: "OK" as const }) }
      );
      const calls = ctx.jobs.slice(before);
      const summary = {
        outcome: result.outcome,
        code: result.code,
        attemptsUsed: result.attemptsUsed,
        refusals: result.attempts.map((attempt) => `${attempt.stage}:${attempt.code}`),
        elapsedMs: Date.now() - started,
        hostDeadlinesMs: ctx.deadlines.slice(deadlinesBefore),
        calls: calls.map((call) => measured(call.outcome, call.request.maxOutputTokens))
      };
      if (calls.length === 0 || !calls.every((call) => answeredInTime(call.outcome))) throw new Error(JSON.stringify(summary));
      // One deadline per call, or `every` below would pass on none at all.
      if (summary.hostDeadlinesMs.length !== calls.length || !summary.hostDeadlinesMs.every((ms) => ms === LOCATOR_ATTEMPT_LIMITS.timeoutMs)) {
        throw new Error(`the inferences were given ${summary.hostDeadlinesMs.join(", ") || "no"} ms deadlines, not ${LOCATOR_ATTEMPT_LIMITS.timeoutMs} each`);
      }
      return summary;
    });
  await upgrade("a typical upgrade job ends on its merits under its own deadline (after the model load)", "live-locator-typical", TYPICAL_CONTEXT);
  await upgrade("the largest capture context the product sends ends on its merits under its own deadline", "live-locator-largest", LARGEST_CONTEXT);
  await ctx.service.shutdown();
  api.record("counters", (await ctx.service.status()).counters);
}
