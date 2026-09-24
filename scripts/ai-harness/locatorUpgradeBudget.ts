/**
 * The locator-upgrade request against its token budgets, counted with the pack's own tokenizer
 * (vocabulary only: no weights, no inference). Run by `verify:ai-locator-upgrade-budget`.
 *
 * `benchmark:ai-model` judges L1.8 as the prompt's time plus the output cap at the measured decode rate.
 * The cap is honest only if every plan the product can accept fits inside it: a plan cut at the cap is
 * invalid JSON, refused whole, and spends an attempt. So this counts, on the tokenizer the host uses:
 *   - each fixture's prompt exactly as the host tokenizes it, template included, every line whole;
 *   - the longest prompt ANY request can send: a capture at every L2 bound, on its second attempt;
 *   - the longest plan the grammar admits and the compiler accepts — every key written (node-llama-cpp
 *     writes them all), every string at its `maxLength`, `maxScopes` scopes — in English names and test
 *     ids, in both layouts the grammar allows: 4-space indentation and tabs, which cost more;
 *   - the longest plan whose texts are the ones its strategies READ (`LocatorFactory`: `name` only for
 *     `role`), in every register, names with order numbers included: a 200-character candidate value
 *     as the target, and a role scope with an 80-character name and an 80-character `hasText`.
 * Each bound uses the densest of its registers, so a cheaper filler cannot pass it.
 */

import fs from "node:fs";

import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import { evaluateLocatorPlan } from "@src/ai/locatorPlan";
import { LOCATOR_ATTEMPT_LIMITS, LOCATOR_ATTEMPT_SCHEMA } from "@src/ai/locatorUpgradeAttempts";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { CHAT_TEMPLATE, HOST_LIMITS, LARGEST_CONTEXT, LONGEST_REFUSAL, PROMPT_NONCE, TYPICAL_CONTEXT, WEAK_STEP, productLocatorRequest } from "./locatorUpgradePacket";
import { loadRuntime } from "./profile";

export interface BudgetApi {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
}

/** What a locator's texts look like: an accessible name and a test id. */
const ENGLISH = {
  name: "Archive the selected customer order and notify the account owner ",
  testId: "orders-table-row-actions-archive-button-"
};
/** ...and a name carrying an order number. This tokenizer spends a token per digit. */
const REGISTERS = { ...ENGLISH, numbered: "Archive order 40001 and notify the account owner by email " };
/**
 * Names with a number every few characters, and codes: 2.5–4.5 times English per character. Nothing is
 * judged on these; their counts are recorded because a page written like this is where the bounds stop
 * holding (a plan cut at the cap is refused whole, never accepted truncated).
 */
const NOT_JUDGED = {
  numberDense: "Archive order 40001 placed on 21 September 2026 and notify owner 7781 ",
  digitDense: "Order #40001 (ACC-7781-22), due 2026-09-21: 3 of 12 items, EUR 1,249.50 "
};
const fill = (source: string, chars: number): string => source.repeat(Math.ceil(chars / source.length)).slice(0, chars);

/** The longest value `schema` admits: every key, every list full, every string at its limit, the longest enum. */
function longest(schema: AiOutputSchema, filler: string): unknown {
  switch (schema.type) {
    case "object":
      return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, longest(child, filler)]));
    case "array":
      return Array.from({ length: schema.maxItems }, () => longest(schema.items, filler));
    case "string":
      return "enum" in schema ? [...schema.enum].sort((a, b) => b.length - a.length)[0] : fill(filler, schema.maxLength);
    case "boolean":
      return false;
    default:
      return schema.maximum ?? 0;
  }
}

/**
 * The longest plan using only the texts its strategies read: a non-role target reads its value alone,
 * and a role scope its role, name and `hasText`. The longest ARIA role stands in for the scope's value.
 */
function longestRead(filler: string): unknown {
  const plan = longest(LOCATOR_ATTEMPT_SCHEMA, filler) as { target: Record<string, unknown>; scopes: Record<string, unknown>[] };
  return { ...plan, target: { ...plan.target, name: "" }, scopes: plan.scopes.map((scope) => ({ ...scope, strategy: "role", value: "menuitemcheckbox" })) };
}

/** A capture at every L2 bound (`sanitizeUpgradeContext`): the most any page can hand the prompt. */
function boundContext(filler: string) {
  return {
    target: { tag: fill(filler, 20), role: fill(filler, 30), name: fill(filler, 80), type: fill(filler, 20) },
    candidates: Array.from({ length: 5 }, () => ({ strategy: "placeholder", value: fill(filler, 200), name: fill(filler, 80), count: 10_000, fallback: false })),
    // D1 A+B: the widest a container line gets is an authored name AND a stable test id, both offered as
    // ready scopes. A landmark's authored name is offered in every register (a record's is not with digits).
    containers: Array.from({ length: 6 }, () => ({
      kind: "landmark",
      tag: fill(filler, 20),
      role: fill(filler, 30),
      name: fill(filler, 80),
      nameSource: "aria-label",
      testId: fill("orders-table-row-actions-", 60),
      text: ""
    })),
    heading: fill(filler, 80),
    siblingActions: Array.from({ length: 6 }, () => fill(filler, 60)),
    pageKey: "/bound"
  };
}

export async function runLocatorUpgradeBudget(api: BudgetApi): Promise<void> {
  const runtime = await loadRuntime(process.env.AWKIT_HARNESS_REPO_ROOT ?? "");
  const { LlamaText, SpecialTokensText } = runtime;
  const llama = await runtime.getLlama({ gpu: false, build: "never", skipDownload: true, progressLogs: false, logLevel: runtime.LlamaLogLevel.disabled, logger: () => undefined });
  const model = await llama.loadModel({ modelPath: process.env.AWKIT_HARNESS_MODEL_PATH ?? "", vocabOnly: true });
  const count = (text: string): number => model.tokenize(text).length;
  const promptTokens = (system: string, user: string): number =>
    LlamaText([new SpecialTokensText(CHAT_TEMPLATE.systemOpen), system, new SpecialTokensText(CHAT_TEMPLATE.userOpen), user, new SpecialTokensText(CHAT_TEMPLATE.assistantOpen)]).tokenize(model.tokenizer).length;
  const cap = LOCATOR_ATTEMPT_LIMITS.maxOutputTokens;

  await api.step("the template counted here is the host's", () => {
    const host = fs.readFileSync(process.env.AWKIT_HARNESS_HOST_PATH ?? "", "utf8");
    const missing = Object.entries(CHAT_TEMPLATE).filter(([, text]) => !host.includes(JSON.stringify(text)));
    if (missing.length > 0) throw new Error(`not in ai-host.cjs: ${missing.map(([key]) => key).join(", ")}`);
    return { parts: Object.keys(CHAT_TEMPLATE).length };
  });

  const density = (source: string) => count(fill(source, 1_000));
  const densest = (registers: Record<string, string>) => Object.entries(registers).sort(([, a], [, b]) => density(b) - density(a))[0];
  const [register, filler] = densest(REGISTERS);
  api.record("tokensPer1000Chars", Object.fromEntries(Object.entries({ ...REGISTERS, ...NOT_JUDGED }).map(([name, source]) => [name, density(source)])));

  const built = (raw: unknown, refused: boolean) => {
    const request = productLocatorRequest(raw, refused ? [LONGEST_REFUSAL] : []);
    return { request, prompt: buildAiPrompt(request.prompt, new SemanticRedactor(), PROMPT_NONCE) };
  };
  const planTokens = (plan: unknown) => ({ spaces: count(JSON.stringify(plan, null, 4)), tabs: count(JSON.stringify(plan, null, "\t")) });

  /** A request's prompt, counted, with every line it offers shown whole. */
  const measure = (label: string, raw: unknown, refused: boolean) =>
    api.step(label, () => {
      const { request, prompt } = built(raw, refused);
      if (!prompt.ok || prompt.omittedFields.length > 0) throw new Error(`the prompt did not build whole: ${JSON.stringify(prompt)}`);
      const lines = request.prompt.fields.flatMap((field) => field.text?.split("\n") ?? []);
      // Delimited on both sides: a prefix is not a line shown whole.
      const cut = lines.filter((line) => !prompt.user.includes(`\n${line}\n`)).length;
      if (cut > 0) throw new Error(`${cut} lines not shown whole`);
      const tokens = promptTokens(prompt.system, prompt.user);
      if (tokens > HOST_LIMITS.maxPromptTokens || tokens + cap > HOST_LIMITS.contextTokens) throw new Error(`${tokens} prompt tokens, outside the host's limits`);
      return { promptTokens: tokens, systemTokens: count(prompt.system), dataTokens: count(prompt.user), lines: lines.length, dataChars: lines.join("\n").length, maxOutputTokens: cap };
    });
  await measure("typical: one block, every line whole", TYPICAL_CONTEXT, false);
  await measure("largest, first attempt: every line whole", LARGEST_CONTEXT, false);
  await measure("largest, second attempt (the benchmark's packet): every line whole", LARGEST_CONTEXT, true);
  await measure(`the longest prompt ANY request can send: a capture at every L2 bound, second attempt (${register})`, boundContext(filler), true);

  /** A plan the compiler accepts, counted in both layouts against the cap. */
  const fits = (label: string, registers: Record<string, string>, planOf: (filler: string) => unknown) =>
    api.step(label, () => {
      const [name, source] = densest(registers);
      const plan = planOf(source);
      const baseline = WEAK_STEP.locator!;
      const evaluated = evaluateLocatorPlan(plan, { boundValues: [], baseline, captured: baseline.context });
      // An answer the product refuses anyway bounds nothing: the counted plan must be one it accepts.
      if (!evaluated.ok) throw new Error(`(precondition) the counted plan is refused: ${evaluated.code} ${evaluated.field}`);
      const tokens = planTokens(plan);
      if (Math.max(tokens.spaces, tokens.tabs) > cap) throw new Error(`${JSON.stringify(tokens)} tokens in ${name}, over the ${cap}-token cap`);
      return { planTokens: tokens, maxOutputTokens: cap, register: name };
    });
  await fits("every plan the grammar admits fits the cap in English names and test ids, both layouts", ENGLISH, (source) => longest(LOCATOR_ATTEMPT_SCHEMA, source));
  await fits("every plan using only the texts its strategies read fits the cap, names with numbers included", REGISTERS, longestRead);

  // Recorded, not judged: where the bounds stop holding.
  api.record(
    "notJudged",
    Object.fromEntries(
      Object.entries({ numbered: REGISTERS.numbered, ...NOT_JUDGED }).map(([name, source]) => {
        const { prompt } = built(boundContext(source), true);
        return [name, { longestPlanTokens: planTokens(longest(LOCATOR_ATTEMPT_SCHEMA, source)), longestReadPlanTokens: planTokens(longestRead(source)), boundPromptTokens: prompt.ok ? promptTokens(prompt.system, prompt.user) : null }];
      })
    )
  );
  await model.dispose();
  await llama.dispose();
}
