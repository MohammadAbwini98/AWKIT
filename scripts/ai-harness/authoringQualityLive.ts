/**
 * `verify:ai-authoring-quality-live`: the real Qwen3.5-0.8B's validation explanations over L4b's
 * labelled set (scripts/ai-harness/authoringQualitySet.ts), run inside the AI harness
 * (scripts/ai-harness/harnessMain.ts).
 *
 * Each case goes through exactly what `ai:explainValidation` runs: `explainFlowValidation` re-validates
 * the flow with the real `FlowValidator`, builds the request with `buildAuthoringRequest`, and submits it
 * to the production `AiService` with `AUTHORING_LIMITS`, over `AiUtilityHostManager` and the real
 * `ai-host.cjs`. Nine cases, seventeen issues, fourteen L4a codes, both fix kinds.
 *
 * Judged hard, per case: the request is the one the product builds for the labelled flow and sends
 * the labelled codes, fixes and blocking order; the inference gets the feature's own deadline; the
 * answer is accepted and explains every sent issue; no canary planted in the flow's names and values
 * reaches the prompt or an answer; no residual secret. Recorded, not judged: on subject, misattributed,
 * actionable, unsupported claims by kind, each explanation's category, the ranking's order, texts cut
 * by the grammar. No plan sets a target for those (L4's acceptance asks for one before release), so a
 * rate is evidence for the owner, never a pass mark, and an explanation that clears every screen is
 * listed for a person to review, never counted as correct.
 *
 * Scripted controls run first and end the run if one fails: a judge that cannot tell a correct answer
 * from a swapped, vague, leaking, partial, over-ranking, unactionable, unsupported or misordered one
 * cannot judge the model.
 *
 * `AWKIT_HARNESS_CASES` runs part of the set, so a caller with the 600 s tool ceiling can run it in parts.
 *
 * Counts, codes and timings only, never model text.
 */

import { explainFlowValidation, type AiAssistDeps } from "@main/ai/aiAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { AUTHORING_LIMITS, buildAuthoringRequest, parseAuthoringAnswer } from "@src/ai/authoringExplanation";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { isExecutionBlocking, validateFlowDefinition } from "@src/validation/FlowValidator";

import {
  LABELLED_SET,
  authoringControlFailures,
  deliveryViolations,
  judgeAuthoringAnswer,
  rankingControlFailures,
  type AuthoringJudgement,
  type ExplanationCategory,
  type LabelledCase,
  type UnsupportedKind
} from "./authoringQualitySet";
import { hello, measured, observed, type FeatureLiveApi } from "./featureLive";

/** The request `explainFlowValidation` builds for a case, with no saved library beside it. */
const requestOf = (labelled: LabelledCase) => buildAuthoringRequest(validateFlowDefinition(labelled.flow, { referenceableFlowIds: new Set([labelled.flow.id]) }));

export async function runAuthoringQualityLive(api: FeatureLiveApi): Promise<void> {
  const ctx = observed(api);
  api.record("deadlineMs", AUTHORING_LIMITS.timeoutMs);
  await hello(api, ctx);

  const controls = await api.step("control: the judge and the delivery check hold on scripted answers", () => {
    const byId = (id: string) => {
      const labelled = LABELLED_SET.find((c) => c.id === id);
      return labelled ? requestOf(labelled) : undefined;
    };
    const cycle = byId("cycle");
    const priority = byId("priority");
    const failures = [...(cycle ? authoringControlFailures(cycle) : ["no cycle case"]), ...(priority ? rankingControlFailures(priority) : ["no priority case"])];
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

  const deps: AiAssistDeps = { submit: ctx.submit, policy: async () => ({ enabled: true, featureTiers: {} }), savedFlowIds: async () => [] };
  const results: Array<{ labelled: LabelledCase; judged: AuthoringJudgement; inferMs: number | null }> = [];
  // Accepted: the product parsed the answer. Rejected: the model answered and the product refused it.
  // Inconclusive: no answer to judge (a deadline, a host failure).
  const responses = { accepted: 0, rejected: 0, inconclusive: 0 };
  const only = (process.env.AWKIT_HARNESS_CASES ?? "").split(",").filter(Boolean);
  const cases = only.length > 0 ? LABELLED_SET.filter((c) => only.includes(c.id)) : LABELLED_SET;
  api.record("cases", cases.map((c) => c.id));
  for (const labelled of cases) {
    await api.step(`${labelled.id}: ${labelled.families}`, async () => {
      const before = ctx.jobs.length;
      const deadlinesBefore = ctx.deadlines.length;
      const started = Date.now();
      const view = await explainFlowValidation(1, { requestId: `quality-${labelled.id}`, profile: labelled.flow }, deps);
      const elapsedMs = Date.now() - started;
      const job = ctx.jobs[before];
      if (!job) throw new Error(`no model call was made: ${view.code}`);
      const request = requestOf(labelled);
      if (!request) throw new Error("the labelled flow has nothing to ask");
      // The request the product sent, rebuilt from the same flow: the judge needs its issues.
      const sameRequest = JSON.stringify([request.prompt, request.schema]) === JSON.stringify([job.request.prompt, job.request.schema]);
      const sent = request.issues.map((ref) => ({ code: ref.issue.code, fixable: ref.fixable, blocking: isExecutionBlocking(ref.issue) }));
      const prompt = buildAiPrompt(job.request.prompt, new SemanticRedactor(), "0f1e2d3c4b5a6978");
      const violations =
        job.outcome.status === "ok" ? deliveryViolations(request, job.outcome.value, prompt.ok ? `${prompt.system}\n${prompt.user}` : "") : [`NOT_ANSWERED_${job.outcome.status}`];
      const answer = job.outcome.status === "ok" ? parseAuthoringAnswer(job.outcome.value, request) : null;
      const judged = answer?.ok ? judgeAuthoringAnswer(request, answer) : null;
      const refusedOnContent = job.outcome.status === "failed" && ["MALFORMED_OUTPUT", "SCHEMA_REJECTED"].includes(job.outcome.code);
      responses[answer?.ok ? "accepted" : answer || refusedOnContent ? "rejected" : "inconclusive"] += 1;
      const deadlines = ctx.deadlines.slice(deadlinesBefore);
      const timing = measured(job.outcome, job.request.maxOutputTokens);
      const summary = {
        code: view.code,
        sent: sent.map((s) => `${s.code}${s.fixable ? "+fix" : ""}${s.blocking ? "+blocks" : ""}`),
        truncated: request.truncated,
        sameRequest,
        promptBuilt: prompt.ok,
        violations,
        judged,
        shownRanking: view.ranking.length,
        hostDeadlinesMs: deadlines,
        elapsedMs,
        ...timing
      };
      if (!sameRequest || JSON.stringify(sent) !== JSON.stringify(labelled.sent) || request.truncated !== (labelled.truncated ?? 0) || !prompt.ok) throw new Error(`not the labelled request: ${JSON.stringify(summary)}`);
      if (deadlines.length !== 1 || deadlines[0] !== AUTHORING_LIMITS.timeoutMs) throw new Error(`the inference was given ${deadlines.join(", ") || "no"} ms, not ${AUTHORING_LIMITS.timeoutMs}`);
      // Delivered, every sent issue explained, nothing leaked. Arriving is not enough.
      if (view.code !== "OK" || violations.length > 0 || !judged || view.explanations.length !== sent.length) throw new Error(JSON.stringify(summary));
      results.push({ labelled, judged, inferMs: "inferMs" in timing ? (timing.inferMs ?? null) : null });
      return summary;
    });
  }

  await api.step("the labelled set: every answer delivered, every issue explained, nothing leaked; quality recorded", () => {
    const total = (key: "sent" | "explained" | "onSubject" | "misattributed" | "actionable" | "cutByGrammar" | "ranked") => results.reduce((n, r) => n + r.judged[key], 0);
    const sum = <K extends string>(pick: (j: AuthoringJudgement) => Partial<Record<K, number>>) =>
      results.reduce<Partial<Record<K, number>>>((acc, r) => {
        for (const [k, v] of Object.entries(pick(r.judged)) as Array<[K, number]>) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {});
    const fixableSent = results.reduce((n, r) => n + r.labelled.sent.filter((s) => s.fixable).length, 0);
    const orders = results.map((r) => r.judged.rankingOrderCorrect).filter((v): v is boolean => v !== null);
    const orderable = results.filter((r) => new Set(r.labelled.sent.filter((s) => s.fixable).map((s) => s.blocking)).size === 2).length;
    const infer = results.map((r) => r.inferMs).filter((v): v is number => v !== null);
    const quality = {
      cases: results.length,
      responses,
      issuesSent: total("sent"),
      explained: total("explained"),
      // Proxies. A screen can prove an explanation wrong; only a person can prove one right.
      onSubject: `${total("onSubject")}/${total("sent")}`,
      misattributed: total("misattributed"),
      actionable: `${total("actionable")}/${total("sent")}`,
      unsupported: sum<UnsupportedKind>((j) => j.unsupported),
      categories: sum<ExplanationCategory>((j) => j.categories),
      forReview: Object.fromEntries(results.filter((r) => r.judged.review.length > 0).map((r) => [r.labelled.id, r.judged.review])),
      ranked: `${total("ranked")} of ${fixableSent} fixable`,
      rankingOrder: `${orders.filter(Boolean).length} in order, ${orders.filter((v) => !v).length} out of order, of ${orderable} case(s) where one fix is more urgent`,
      cutByGrammar: total("cutByGrammar"),
      textChars: results.flatMap((r) => r.judged.textChars),
      inferMs: infer.length > 0 ? { min: Math.min(...infer), max: Math.max(...infer), median: [...infer].sort((a, b) => a - b)[Math.floor(infer.length / 2)] } : null,
      perCase: Object.fromEntries(
        results.map((r) => [r.labelled.id, `${r.judged.onSubject}/${r.judged.sent} on subject, ${r.judged.actionable} actionable, ${r.judged.misattributed} misattributed, ${JSON.stringify(r.judged.categories)}`])
      ),
      target: "none recorded: L4's acceptance asks for an explanation quality target before release"
    };
    api.record("quality", quality);
    if (results.length !== cases.length) throw new Error(`${results.length} of ${cases.length} cases delivered`);
    return quality;
  });
  await ctx.service.shutdown();
  api.record("counters", (await ctx.service.status()).counters);
}
