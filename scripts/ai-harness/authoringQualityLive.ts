/**
 * `verify:ai-authoring-quality-live`: the real Qwen3.5-0.8B's validation explanations over L4b's
 * labelled set (scripts/ai-harness/authoringQualitySet.ts), run inside the AI harness
 * (scripts/ai-harness/harnessMain.ts).
 *
 * Each case goes through exactly what `ai:explainValidation` runs: `explainFlowValidation` re-validates
 * the flow with the real `FlowValidator`, builds the request with `buildAuthoringRequest`, and submits it
 * to the production `AiService` with `AUTHORING_LIMITS`, over `AiUtilityHostManager` and the real
 * `ai-host.cjs`. Six cases, two issues each, twelve L4a codes, both fix kinds.
 *
 * Judged hard, per case: the request is the one the product builds for the labelled flow and sends
 * the labelled codes; the inference gets the feature's own deadline; the answer is accepted and explains
 * every sent issue; no canary planted in the flow's names and values reaches the prompt or an answer;
 * no residual secret. Recorded, not judged: whether each explanation names its own issue's subject,
 * whether it describes another sent issue instead, texts cut by the grammar, and the ranking. No plan
 * sets a target for those (L4's acceptance asks for one before release), so a rate is evidence for the
 * owner, never a pass mark.
 *
 * A scripted control runs first and ends the run if it fails: a judge that cannot tell a correct answer
 * from a swapped, vague, leaking, partial or over-ranking one cannot judge the model.
 *
 * Counts, codes and timings only, never model text.
 */

import { explainFlowValidation, type AiAssistDeps } from "@main/ai/aiAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { AUTHORING_LIMITS, buildAuthoringRequest, parseAuthoringAnswer } from "@src/ai/authoringExplanation";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

import { LABELLED_SET, authoringControlFailures, deliveryViolations, judgeAuthoringAnswer, type AuthoringJudgement, type LabelledCase } from "./authoringQualitySet";
import { hello, measured, observed, type FeatureLiveApi } from "./featureLive";

/** The request `explainFlowValidation` builds for a case, with no saved library beside it. */
const requestOf = (labelled: LabelledCase) => buildAuthoringRequest(validateFlowDefinition(labelled.flow, { referenceableFlowIds: new Set([labelled.flow.id]) }));

export async function runAuthoringQualityLive(api: FeatureLiveApi): Promise<void> {
  const ctx = observed(api);
  api.record("deadlineMs", AUTHORING_LIMITS.timeoutMs);
  await hello(api, ctx);

  const controls = await api.step("control: the judge and the delivery check hold on scripted answers", () => {
    const cycle = LABELLED_SET.find((c) => c.id === "cycle");
    const request = cycle ? requestOf(cycle) : undefined;
    const failures = request ? authoringControlFailures(request) : ["no cycle case"];
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
  const results: Array<{ labelled: LabelledCase; judged: AuthoringJudgement }> = [];
  for (const labelled of LABELLED_SET) {
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
      const sent = request.issues.map((ref) => ({ code: ref.issue.code, fixable: ref.fixable }));
      const prompt = buildAiPrompt(job.request.prompt, new SemanticRedactor(), "0f1e2d3c4b5a6978");
      const violations =
        job.outcome.status === "ok" ? deliveryViolations(request, job.outcome.value, prompt.ok ? `${prompt.system}\n${prompt.user}` : "") : [`NOT_ANSWERED_${job.outcome.status}`];
      const answer = job.outcome.status === "ok" ? parseAuthoringAnswer(job.outcome.value, request) : null;
      const judged = answer?.ok ? judgeAuthoringAnswer(request, answer) : null;
      const deadlines = ctx.deadlines.slice(deadlinesBefore);
      const summary = {
        code: view.code,
        sent: sent.map((s) => `${s.code}${s.fixable ? "+fix" : ""}`),
        sameRequest,
        promptBuilt: prompt.ok,
        violations,
        judged,
        shownRanking: view.ranking.length,
        hostDeadlinesMs: deadlines,
        elapsedMs,
        ...measured(job.outcome, job.request.maxOutputTokens)
      };
      if (!sameRequest || JSON.stringify(sent) !== JSON.stringify(labelled.sent) || !prompt.ok) throw new Error(`not the labelled request: ${JSON.stringify(summary)}`);
      if (deadlines.length !== 1 || deadlines[0] !== AUTHORING_LIMITS.timeoutMs) throw new Error(`the inference was given ${deadlines.join(", ") || "no"} ms, not ${AUTHORING_LIMITS.timeoutMs}`);
      // Delivered, every sent issue explained, nothing leaked. Arriving is not enough.
      if (view.code !== "OK" || violations.length > 0 || !judged || view.explanations.length !== sent.length) throw new Error(JSON.stringify(summary));
      results.push({ labelled, judged });
      return summary;
    });
  }

  await api.step("the labelled set: every answer delivered, every issue explained, nothing leaked; quality recorded", () => {
    const total = (key: "sent" | "explained" | "onSubject" | "misattributed" | "cutByGrammar" | "ranked") => results.reduce((n, r) => n + r.judged[key], 0);
    const fixableSent = results.reduce((n, r) => n + r.labelled.sent.filter((s) => s.fixable).length, 0);
    const quality = {
      cases: results.length,
      issuesSent: total("sent"),
      explained: total("explained"),
      onSubject: `${total("onSubject")}/${total("sent")}`,
      misattributed: total("misattributed"),
      cutByGrammar: total("cutByGrammar"),
      ranked: `${total("ranked")} of ${fixableSent} fixable`,
      textChars: results.flatMap((r) => r.judged.textChars),
      perCase: Object.fromEntries(results.map((r) => [r.labelled.id, `${r.judged.onSubject}/${r.judged.sent} on subject, ${r.judged.misattributed} misattributed`])),
      target: "none recorded: L4's acceptance asks for an explanation quality target before release"
    };
    api.record("quality", quality);
    if (results.length !== LABELLED_SET.length) throw new Error(`${results.length} of ${LABELLED_SET.length} cases delivered`);
    return quality;
  });
  await ctx.service.shutdown();
  api.record("counters", (await ctx.service.status()).counters);
}
