/**
 * The failure-analysis request against its token budgets, counted with the pack's own tokenizer
 * (vocabulary only: no weights, no inference). Run by `verify:ai-failure-analysis-budget`.
 *
 * `benchmark:ai-model` judges L1.8 as the prompt's time plus the output cap at the measured decode rate.
 * The cap is honest only if every answer the product can accept fits inside it: an answer cut at the cap
 * is invalid JSON, and the product discards it whole. So this counts, on the tokenizer the host uses:
 *   - each fixture's prompt exactly as the host tokenizes it, template included, with every offered
 *     evidence line whole in it;
 *   - the longest answer each request's grammar admits and the parser accepts — every list at its
 *     `maxItems` of distinct ids, every string at its `maxLength` — in both layouts the runtime's grammar
 *     allows: 4-space indentation (`scopePadSpaces`) and tabs, which cost more;
 *   - the same answer with the longest ids L5a can mint, which bounds every request, not just these.
 * The strings are English in the register of a real analysis, digits and codes included; the check
 * that it is at least as dense as plain English stops a cheaper filler from passing the budget.
 * The runtime is driven in this process, as `profile.ts` does, because the host has no tokenize call.
 */

import fs from "node:fs";

import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { FAILURE_ANALYSIS_LIMITS, type FailureAnalysisRequest } from "@src/ai/failureAnalysis";
import { DEFAULT_EVIDENCE_LIMITS } from "@src/runner/evidence/ExecutionEvidence";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { LARGEST_FAILURE, NONCE, RUNNER_ONLY_FAILURE, TYPICAL_FAILURE, failedRun, productFailureRequest, type FixtureEvent } from "./failureAnalysisPacket";
import { loadRuntime } from "./profile";

export interface BudgetApi {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
}

/** The host's chat template (`TEMPLATE` in ai-host.cjs); the first step proves it is still the host's. */
const TEMPLATE = Object.freeze({
  systemOpen: "<|im_start|>system\n",
  userOpen: "<|im_end|>\n<|im_start|>user\n",
  assistantOpen: "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
});

const PROSE =
  "The payment authorization request returned HTTP 502 at 4700 ms, so the order was never confirmed and the receipt " +
  "page failed to render its confirmation number. Check the payment gateway logs for the authorization call, confirm " +
  "the gateway was reachable from the test environment, and retry the run once the service reports healthy again. ";
const PLAIN =
  "Check the server logs for the failed order submission request and confirm that the order service is running and " +
  "reachable from the test environment before running the flow again. ";
const fill = (source: string, chars: number): string => source.repeat(Math.ceil(chars / source.length)).slice(0, chars);

type Schema = Record<string, any>;

/** The longest answer `request`'s grammar admits that the parser also accepts: distinct ids, every list and string full. */
function longestAnswer(request: FailureAnalysisRequest, idsOf?: (count: number, offset: number) => string[]): unknown {
  const conclusion = (request.schema.properties as Schema).conclusion as Schema;
  if (conclusion.maxItems === 0) return { version: 1, conclusion: [] };
  const item = conclusion.items.properties as Schema;
  const primaryMax: number = item.primaryEvidenceIds.maxItems;
  const secondaryMax: number = item.secondaryEvidenceIds.maxItems;
  const longestFirst = (ids: string[]) => [...ids].sort((a, b) => b.length - a.length);
  const primary = idsOf ? idsOf(primaryMax, 0) : longestFirst(item.primaryEvidenceIds.items.enum).slice(0, primaryMax);
  const secondary = idsOf
    ? idsOf(secondaryMax, primaryMax)
    : longestFirst((item.secondaryEvidenceIds.items.enum as string[]).filter((id) => !primary.includes(id))).slice(0, secondaryMax);
  return {
    version: 1,
    conclusion: [
      {
        primaryEvidenceIds: primary,
        secondaryEvidenceIds: secondary,
        category: fill(PROSE, item.category.maxLength),
        explanation: fill(PROSE, item.explanation.maxLength),
        investigationSteps: Array.from({ length: item.investigationSteps.maxItems }, () => fill(PROSE, item.investigationSteps.items.maxLength))
      }
    ]
  };
}

export async function runFailureAnalysisBudget(api: BudgetApi): Promise<void> {
  const runtime = await loadRuntime(process.env.AWKIT_HARNESS_REPO_ROOT ?? "");
  const { LlamaText, SpecialTokensText } = runtime;
  const llama = await runtime.getLlama({ gpu: false, build: "never", skipDownload: true, progressLogs: false, logLevel: runtime.LlamaLogLevel.disabled, logger: () => undefined });
  const model = await llama.loadModel({ modelPath: process.env.AWKIT_HARNESS_MODEL_PATH ?? "", vocabOnly: true });
  const count = (text: string): number => model.tokenize(text).length;
  const promptTokens = (system: string, user: string): number =>
    LlamaText([new SpecialTokensText(TEMPLATE.systemOpen), system, new SpecialTokensText(TEMPLATE.userOpen), user, new SpecialTokensText(TEMPLATE.assistantOpen)]).tokenize(model.tokenizer).length;
  const cap = FAILURE_ANALYSIS_LIMITS.maxOutputTokens;
  /** Both layouts the grammar admits, the costlier one checked against the cap. */
  const answerTokens = (answer: unknown) => ({ spaces: count(JSON.stringify(answer, null, 4)), tabs: count(JSON.stringify(answer, null, "\t")) });
  const fits = (label: string, tokens: { spaces: number; tabs: number }) => {
    if (Math.max(tokens.spaces, tokens.tabs) > cap) throw new Error(`${label}: ${JSON.stringify(tokens)} tokens, over the ${cap}-token cap`);
  };

  await api.step("the template counted here is the host's", () => {
    const host = fs.readFileSync(process.env.AWKIT_HARNESS_HOST_PATH ?? "", "utf8");
    const missing = Object.entries(TEMPLATE).filter(([, text]) => !host.includes(JSON.stringify(text)));
    if (missing.length > 0) throw new Error(`not in ai-host.cjs: ${missing.map(([key]) => key).join(", ")}`);
    return { parts: Object.keys(TEMPLATE).length };
  });
  await api.step("the answer text is at least as token-dense as plain English", () => {
    const tokens = { prose: count(fill(PROSE, 1_000)), plain: count(fill(PLAIN, 1_000)) };
    if (tokens.prose < tokens.plain) throw new Error(JSON.stringify(tokens));
    return { tokensPer1000Chars: tokens };
  });

  const measure = (label: string, events: FixtureEvent[], kind: Parameters<typeof failedRun>[2]) =>
    api.step(label, () => {
      const request = productFailureRequest(failedRun(`exec-budget-${kind}`, events, kind));
      const prompt = buildAiPrompt(request.prompt, new SemanticRedactor(), NONCE);
      if (!prompt.ok || prompt.omittedFields.length > 0) throw new Error(`the prompt did not build whole: ${JSON.stringify(prompt)}`);
      // Every id the grammar offers is one whose line the model is shown, and no line is cut.
      const unseen = request.evidence.filter((event) => !prompt.user.includes(`\n${event.id}: ${event.source} `)).map((event) => event.id);
      const cut = request.prompt.fields.flatMap((field) => field.text?.split("\n") ?? []).filter((line) => !prompt.user.includes(line));
      if (unseen.length > 0 || cut.length > 0) throw new Error(`offered without their line: [${unseen.join(", ")}]; lines not shown whole: ${cut.length}`);
      const answer = answerTokens(longestAnswer(request));
      fits(label, answer);
      return {
        promptTokens: promptTokens(prompt.system, prompt.user),
        systemTokens: count(prompt.system),
        blockTokens: Object.fromEntries(prompt.user.split(/\n(?=<<<DATA )/).map((block) => [block.match(/name="(\w+)"/)?.[1] ?? "?", count(block)])),
        evidenceOffered: request.evidence.length,
        longestAnswerTokens: answer,
        maxOutputTokens: cap
      };
    });
  await measure("typical: whole evidence, and its longest acceptable answer fits the cap", TYPICAL_FAILURE, "assertion");
  await measure("runner-only: whole evidence, and its only answer, a decline, fits the cap", RUNNER_ONLY_FAILURE, "timeout");
  const largest = await measure("largest: whole evidence, and its longest acceptable answer fits the cap", LARGEST_FAILURE, "timeout");

  await api.step("the longest answer ANY request can produce fits the cap: the longest ids L5a mints", () => {
    if (!largest) throw new Error("(precondition) the largest request was not measured");
    const request = productFailureRequest(failedRun("exec-budget-bound", LARGEST_FAILURE, "timeout"));
    // Every list full, as the largest request's schema allows, with ids as long as an instance's evidence
    // can number them (`ev200`): a bound over requests, not a property of this fixture.
    const longest = String(DEFAULT_EVIDENCE_LIMITS.maxEventsPerInstance);
    const idsOf = (n: number, offset: number) => Array.from({ length: n }, (_, i) => `ev${Number(longest) - offset - i}`);
    const answer = answerTokens(longestAnswer(request, idsOf));
    fits("the bound", answer);
    return { longestAnswerTokens: answer, maxOutputTokens: cap, idLength: `ev${longest}`.length };
  });
  await model.dispose();
  await llama.dispose();
}
