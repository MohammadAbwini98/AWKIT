/**
 * `verify:ai-error-quality-live`: the real Qwen3.5-0.8B's failure analyses over L5's labelled set
 * (scripts/ai-harness/errorQualitySet.ts), run inside the AI harness (scripts/ai-harness/harnessMain.ts).
 *
 * Each asked row goes through exactly what `ai:analyzeFailure` runs: `analyzeFailure` reads the stored
 * report, coalesces its batch, builds the request with `buildFailureAnalysisRequest` and submits it to the
 * production `AiService` with `FAILURE_ANALYSIS_LIMITS`, over `AiUtilityHostManager` and the real
 * `ai-host.cjs`, then parses, redacts, rescans and saves the answer.
 *
 * Judged hard: the batch coalesces as labelled (500 rows cost one call, a 409 and a 422 two); a pass and
 * an insufficient baseline cost no call at all; every other asked row is the request the product builds,
 * gets the feature's own deadline, and is delivered and saved; no canary reaches the prompt or an answer;
 * no residual secret; every cited id's line was shown whole.
 *
 * Recorded, not judged: L5's metrics. Baseline accuracy, AI accuracy, the AI's improvement over the
 * baseline, false attribution, declines, evidence-link accuracy, coalescing, calls per batch, latency;
 * for the whole set and again for the eight rows `4f81424a` measured, before the two anchoring cases.
 * ROADMAP rule 7 lets AI run automatically only where it beats the baseline on this set, so the gate
 * records whether it did; the automatic analysis that rule governs is not built.
 *
 * A scripted control of the judge runs first and ends the run if it fails. Counts, codes and timings
 * only, never model text.
 */

import { analyzeFailure, failureBatch } from "@main/ai/aiAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { FAILURE_ANALYSIS_LIMITS, coalesceFailures, parseFailureAnalysis } from "@src/ai/failureAnalysis";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import {
  ANCHORING_ITEMS,
  ERROR_SET,
  buildCase,
  deliveryViolations,
  errorControlFailures,
  judgeFailureAnswer,
  noCauseControlFailures,
  requestFor,
  type ErrorCase,
  type FailureJudgement
} from "./errorQualitySet";
import { NONCE, answerShape } from "./failureAnalysisPacket";
import { hello, measured, observed, type FeatureLiveApi } from "./featureLive";

export async function runErrorQualityLive(api: FeatureLiveApi): Promise<void> {
  const ctx = observed(api);
  api.record("deadlineMs", FAILURE_ANALYSIS_LIMITS.timeoutMs);
  await hello(api, ctx);

  const controls = await api.step("control: the judge and the delivery check hold on scripted answers", () => {
    const failures = (
      [
        ["transport-noise", errorControlFailures],
        ["timeout-unrelated-console", noCauseControlFailures]
      ] as const
    ).flatMap(([id, controlsOf]) => {
      const labelled = ERROR_SET.find((c) => c.id === id);
      if (!labelled) return [`no ${id} case`];
      const { report, labels } = buildCase(labelled);
      const instanceId = report.instances[0].instanceId;
      const request = requestFor(report, instanceId);
      const prompt = request ? buildAiPrompt(request.prompt, new SemanticRedactor(), NONCE) : null;
      return request && prompt?.ok ? controlsOf(request, labels.get(instanceId)!, prompt) : [`${id}: no request or prompt`];
    });
    if (failures.length > 0) throw new Error(failures.join("; "));
    return { failures: 0 };
  });
  if (controls === undefined) {
    await api.step("the real model is not judged, because a control failed", () => {
      throw new Error("a control failed");
    });
    await ctx.service.shutdown();
    return;
  }

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
  const results: Array<{ labelled: ErrorCase; judged: FailureJudgement | null; inferMs: number | null; stats: ReturnType<typeof coalesceFailures>["stats"] }> = [];
  // The whole set by default. A named subset (`--cases`) lets a caller with a time limit run it in parts.
  const only = (process.env.AWKIT_HARNESS_CASES ?? "").split(",").filter(Boolean);
  const cases = only.length > 0 ? ERROR_SET.filter((c) => only.includes(c.id)) : ERROR_SET;
  api.record("cases", cases.map((c) => c.id));

  for (const labelled of cases) {
    await api.step(`${labelled.id}: ${labelled.covers.join(", ")}`, async () => {
      const { report, labels } = buildCase(labelled);
      reports.set(report.executionId, report);
      const stats = coalesceFailures(failureBatch(report)).stats;
      if (JSON.stringify(stats) !== JSON.stringify(labelled.batch)) throw new Error(`coalesced ${JSON.stringify(stats)}, labelled ${JSON.stringify(labelled.batch)}`);
      const rows: unknown[] = [];
      for (const index of labelled.ask) {
        const instance = report.instances[index];
        const before = ctx.jobs.length;
        const deadlinesBefore = ctx.deadlines.length;
        const started = Date.now();
        const view = await analyzeFailure(1, { requestId: `quality-${labelled.id}-${index + 1}`, executionId: report.executionId, instanceId: instance.instanceId }, deps);
        const elapsedMs = Date.now() - started;
        const calls = ctx.jobs.slice(before);
        if (!labelled.expectsCall) {
          // A pass and an insufficient baseline are answered without the model.
          if (calls.length !== 0 || view.code !== "NOTHING_TO_ASK") throw new Error(`expected no call and NOTHING_TO_ASK: ${calls.length} call(s), ${view.code}`);
          rows.push({ row: index + 1, code: view.code, calls: 0 });
          results.push({ labelled, judged: null, inferMs: null, stats });
          continue;
        }
        const [job] = calls;
        if (!job || calls.length !== 1) throw new Error(`${calls.length} model calls for one explicit request: ${view.code}`);
        const request = requestFor(report, instance.instanceId);
        if (!request) throw new Error("the labelled row builds no request");
        // The request the product sent, rebuilt from the same report: the judge needs its evidence.
        const sameRequest = JSON.stringify([request.prompt, request.schema]) === JSON.stringify([job.request.prompt, job.request.schema]);
        const prompt = buildAiPrompt(job.request.prompt, new SemanticRedactor(), NONCE);
        const violations = job.outcome.status === "ok" && prompt.ok ? deliveryViolations(request, job.outcome.value, prompt) : [`NOT_ANSWERED_${job.outcome.status}`];
        const answer = job.outcome.status === "ok" ? parseFailureAnalysis(job.outcome.value, request) : null;
        const judged = answer?.ok && prompt.ok ? judgeFailureAnswer(request, answer, labels.get(instance.instanceId)!, prompt.user) : null;
        const deadlines = ctx.deadlines.slice(deadlinesBefore);
        const timing = measured(job.outcome, job.request.maxOutputTokens);
        const summary = {
          row: index + 1,
          code: view.code,
          stored: view.stored === true,
          coalescedCount: view.coalescedCount,
          sameRequest,
          violations,
          judged,
          shape: job.outcome.status === "ok" ? answerShape(job.outcome.value) : null,
          hostDeadlinesMs: deadlines,
          elapsedMs,
          ...timing
        };
        if (!sameRequest || !prompt.ok) throw new Error(`not the product's request: ${JSON.stringify(summary)}`);
        if (deadlines.length !== 1 || deadlines[0] !== FAILURE_ANALYSIS_LIMITS.timeoutMs) throw new Error(`the inference was given ${deadlines.join(", ") || "no"} ms, not ${FAILURE_ANALYSIS_LIMITS.timeoutMs}`);
        if (view.coalescedCount !== request.group.count) throw new Error(`the view names ${view.coalescedCount} instances, the group ${request.group.count}`);
        // Delivered, saved, nothing leaked, every citation one the model was shown. Arriving is not enough.
        if (view.code !== "OK" || !summary.stored || violations.length > 0 || !judged) throw new Error(JSON.stringify(summary));
        rows.push(summary);
        results.push({ labelled, judged, inferMs: "inferMs" in timing ? (timing.inferMs ?? null) : null, stats });
      }
      return { stats, rows };
    });
  }

  await api.step("the labelled set: every row delivered as the product contract requires; L5's metrics recorded", () => {
    const metrics = (rows: typeof results) => {
      const judged = rows.map((r) => r.judged).filter((j): j is FailureJudgement => j !== null);
      const count = (test: (j: FailureJudgement) => boolean) => judged.filter(test).length;
      const cited = judged.reduce((n, j) => n + j.cited, 0);
      const baselineRight = count((j) => j.baselineCorrect);
      const aiRight = count((j) => j.aiCorrect);
      return {
        rowsAnalysed: judged.length,
        baselineAccuracy: `${baselineRight}/${judged.length}`,
        aiAccuracy: `${aiRight}/${judged.length}`,
        // L5's "AI improvement over baseline": rows the AI got right that the baseline did not, less the reverse.
        aiImprovementOverBaseline: count((j) => j.aiCorrect && !j.baselineCorrect) - count((j) => !j.aiCorrect && j.baselineCorrect),
        falseAttributions: count((j) => j.falseAttribution),
        // Anchoring, measured: the baseline is wrong and the AI rests on the same event it did.
        echoesWrongBaseline: count((j) => !j.baselineCorrect && j.citesBaselineLead),
        declined: count((j) => !j.concluded),
        evidenceLinkAccuracy: `${judged.reduce((n, j) => n + j.citedShownWhole, 0)}/${cited}`,
        // ROADMAP rule 7: AI runs automatically only where it beats the baseline on the labelled set.
        beatsBaseline: aiRight > baselineRight
      };
    };
    const inferMs = results.map((r) => r.inferMs).filter((ms): ms is number => ms !== null);
    const quality = {
      ...metrics(results),
      // The eight rows 4f81424a measured, so a later prompt is compared like for like.
      rowsOf4f81424a: metrics(results.filter((r) => !r.labelled.covers.some((item) => ANCHORING_ITEMS.includes(item)))),
      zeroCallRows: results.filter((r) => !r.labelled.expectsCall).length,
      coalescing: Object.fromEntries(
        cases.filter((c) => c.batch.failures > 1).map((c) => [c.id, `${c.batch.failures} failures → ${c.batch.signatures} signature(s) → ${c.batch.analyses} call(s)`])
      ),
      callsPerBatch: Object.fromEntries(cases.map((c) => [c.id, c.batch.analyses])),
      inferMs: { min: Math.min(...inferMs), max: Math.max(...inferMs), total: inferMs.reduce((a, b) => a + b, 0) },
      privacy: "no canary in any prompt or answer, no residual secret (hard, per row)",
      perRow: results.filter((r) => r.judged).map((r) => `${r.labelled.id}: baseline ${r.judged!.baselineCorrect ? "right" : "wrong"}, AI ${r.judged!.aiCorrect ? "right" : r.judged!.falseAttribution ? "false attribution" : "declined"}`)
    };
    api.record("quality", quality);
    const expected = cases.reduce((n, c) => n + c.ask.length, 0);
    if (results.length !== expected) throw new Error(`${results.length} of ${expected} rows completed`);
    return quality;
  });
  await ctx.service.shutdown();
  api.record("counters", (await ctx.service.status()).counters);
}
