/**
 * The L1.8 `locatorUpgrade` workload, as ONE definition: the product's own request, not a stand-in.
 *
 * It was defined inside `scripts/ai-harness/bench.ts`, which imports `electron` and therefore cannot
 * be loaded by anything but the Electron harness. The portable offline bundle
 * (`scripts/offline-benchmark/runner.ts`) has to run the SAME packet on a machine with no Electron,
 * so the packet moved here instead of being copied: a copy is a workload that silently stops being
 * the same workload the first time either side is edited.
 *
 * Until 2026-09-22 that packet was synthetic: generated prose in four DATA blocks, a choose-a-candidate
 * schema the product never sends, at a 192-token cap while the product asked for 512. It passed while
 * the product's own request projected past the ceiling at its own cap (L1 plan). It is now built the way
 * `runLocatorUpgradeAttempts` builds its job, by `locatorAttemptJob`, over the capture contexts
 * `verify:ai-locator-upgrade-live` sends through the product path, and judged by the product's own
 * output contract, compiler and intent guard.
 *
 * Nothing in this module imports Electron, Node built-ins aside, so it bundles for plain Node.
 *
 * What regression makes a consumer fail? Changing the prompt, the schema or `maxOutputTokens` changes
 * `identity`, and BOTH the Electron benchmark and the portable bundle at once — which is the point.
 * `benchmark:ai-model` measures the scenario again whenever `identity` moves, and
 * `verify:ai-locator-attempts` proves the packet equal to the job the product submits.
 */

import { createHash } from "node:crypto";

import { validateAiOutput } from "@src/ai/AiOutputContract";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { evaluateLocatorPlan } from "@src/ai/locatorPlan";
import { LOCATOR_ATTEMPT_LIMITS, locatorAttemptJob, type LocatorAttemptRecord, type LocatorUpgradeAttemptInput } from "@src/ai/locatorUpgradeAttempts";
import type { FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { markBoundValues, sanitizeUpgradeContext } from "@src/recorder/upgradeContext";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

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
export const WEAK_STEP = { id: "s-archive", type: "click", name: "Archive item", locator: GUARDED } as FlowStep;
export const BOUND_VALUES = ["Alice Smith", "Bob Jones"];

/** What L3 §7's verifier captures on the Feature Test Lab's locator-upgrade page. */
export const TYPICAL_CONTEXT = {
  target: { tag: "button", role: "button", name: "Archive", type: "" },
  candidates: [{ strategy: "role", value: "button", name: "Archive", count: 2, fallback: false }],
  containers: [{ kind: "card", tag: "section", role: "region", name: "Guarded baselines" }],
  heading: "Locator Upgrade Lab",
  siblingActions: ["Remove", "Swap twins"],
  pageKey: "/recorder-lab/locator-upgrade"
};

const text = (seed: string, length: number): string => seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

/** Every field at L2's own caps: five candidates, six containers, six sibling actions, 80-character texts. */
export const LARGEST_CONTEXT = {
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

/**
 * The refusal whose feedback line is the longest the product writes, as a second attempt carries it.
 * The largest request the product sends is the largest context's second attempt.
 */
export const LONGEST_REFUSAL: LocatorAttemptRecord = { attempt: 1, consumed: true, stage: "intent", code: "INTENT_BOUND_VALUE", field: "scopes.0.hasText" };

/** The job input the live gate hands `runLocatorUpgradeAttempts` for one raw page capture. */
export function locatorInput(raw: unknown, requestId: string): LocatorUpgradeAttemptInput {
  const captured = sanitizeUpgradeContext(raw, { pageAlias: "main", frameDepth: 0 });
  if (!captured) throw new Error("the capture context did not sanitize");
  const upgradeContext = markBoundValues(captured, BOUND_VALUES.map((value) => value.toLowerCase()));
  return { requestId, step: WEAK_STEP, boundValues: BOUND_VALUES, upgradeContext };
}

/** The job the product submits for this capture at this attempt. */
export function productLocatorRequest(raw: unknown, records: readonly LocatorAttemptRecord[] = []) {
  return locatorAttemptJob(locatorInput(raw, "packet"), records, `packet.a${records.length + 1}`);
}

const recordOf = (value: unknown) => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/**
 * A decoded plan's shape, as counts and product enums. Never the model's text: strategies and scope
 * kinds are enum values the schema offers, the rest are lengths.
 */
export function planShape(value: unknown, shown: string) {
  const plan = recordOf(value);
  const target = recordOf(plan?.target);
  if (!plan || !target) return null;
  const scopes = Array.isArray(plan.scopes) ? plan.scopes.map(recordOf).filter((scope) => scope !== null) : [];
  const strings = [target.value, target.name, ...scopes.flatMap((scope) => [scope.value, scope.name, scope.hasText])].filter((s): s is string => typeof s === "string");
  const limits = LOCATOR_ATTEMPT_LIMITS;
  return {
    keys: Object.keys(plan),
    targetKeys: Object.keys(target),
    strategy: target.strategy,
    scopes: scopes.length,
    scopeKinds: scopes.map((scope) => scope.kind),
    chars: strings.map((s) => s.length),
    // A text exactly at its `maxLength` was ended by the grammar, not by the model.
    cutByGrammar: (typeof target.value === "string" && target.value.length === limits.maxValueChars ? 1 : 0) +
      [target.name, ...scopes.flatMap((scope) => [scope.value, scope.name, scope.hasText])].filter((s) => typeof s === "string" && s.length === limits.maxTextChars).length,
    // Grounding, never required: each non-empty text appears in what the model was shown.
    ungrounded: strings.filter((s) => s.trim() && !shown.includes(s.trim())).length
  };
}

/** The length `AiService` generates (`randomBytes(8)`, 16 hex), fixed so the prompt is byte-identical per run. */
export const PROMPT_NONCE = "0f1e2d3c4b5a6978";

export interface Packet {
  name: "locatorUpgrade";
  spec: ReturnType<typeof productLocatorRequest>["prompt"];
  schema: ReturnType<typeof productLocatorRequest>["schema"];
  maxOutputTokens: number;
  nonce: string;
  identity: string;
  assess(value: unknown): Record<string, unknown>;
}

/** The largest request the product sends: the largest capture's second attempt, after the longest refusal line. */
export function locatorUpgradePacket(): Packet {
  const request = productLocatorRequest(LARGEST_CONTEXT, [LONGEST_REFUSAL]);
  const prompt = buildAiPrompt(request.prompt, new SemanticRedactor(), PROMPT_NONCE);
  if (!prompt.ok || prompt.omittedFields.length > 0) throw new Error("the product's locator-upgrade request did not build whole");
  const { maxOutputTokens, schema } = request;
  const identity = createHash("sha256").update(JSON.stringify({ system: prompt.system, user: prompt.user, schema, maxOutputTokens })).digest("hex");
  const input = locatorInput(LARGEST_CONTEXT, "packet");
  return {
    name: "locatorUpgrade",
    spec: request.prompt,
    schema,
    maxOutputTokens,
    nonce: PROMPT_NONCE,
    identity,
    /** The product's own verdict on a decoded plan — its output contract, compiler and intent guard — as codes and counts. */
    assess(value: unknown): Record<string, unknown> {
      const shape = planShape(value, prompt.user);
      if (validateAiOutput(value, schema).length > 0) return { accepted: false, rejection: "SCHEMA_REJECTED", shape };
      const baseline = input.step.locator!;
      const evaluated = evaluateLocatorPlan(value, { boundValues: input.boundValues, baseline, captured: baseline.context });
      if (!evaluated.ok) return { accepted: false, rejection: evaluated.code, field: evaluated.field, shape };
      // Compiled and past the intent guard: what the job hands the browser proof, which needs a page.
      return { accepted: true, meaningChange: evaluated.meaningChange, shape };
    }
  };
}

/**
 * The bounded-schema → GBNF translation `native-hosts/ai/ai-host.cjs` (`toGrammarSchema`) performs
 * before it asks node-llama-cpp for a grammar. It is reproduced here ONLY because the host refuses
 * to run outside an Electron utilityProcess (`if (!process.parentPort) process.exit(2)`), so a
 * plain-Node bundle cannot call into it.
 *
 * The host is the authority. This copy is kept honest at run time rather than by inspection: the
 * portable runner feeds the decoded text back through the product's own `parseAiOutput` against the
 * UNTRANSLATED `AiOutputSchema`, so a translation that admitted the wrong language would produce
 * output the product's validator rejects, and the run would fail rather than quietly report a number.
 *
 * The grammar has no numeric bounds, so `minimum`/`maximum` are dropped here exactly as the host
 * drops them, and `parseAiOutput` enforces them after decoding.
 */
export function toGrammarSchema(schema: unknown, depth = 0): Record<string, unknown> {
  const refuse = (): never => {
    throw new Error("AI_SCHEMA_REQUIRED");
  };
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (depth > 6 || !isPlainObject(schema)) refuse();
  const s = schema as Record<string, any>;
  switch (s.type) {
    case "object": {
      if (s.additionalProperties !== false || !isPlainObject(s.properties)) refuse();
      const keys = Object.keys(s.properties);
      if (keys.length > 64) refuse();
      const required = s.required === undefined ? [] : s.required;
      if (!Array.isArray(required) || !required.every((key: unknown) => typeof key === "string" && keys.includes(key))) refuse();
      const properties: Record<string, unknown> = {};
      for (const key of keys) properties[key] = toGrammarSchema(s.properties[key], depth + 1);
      return { type: "object", properties, required: [...required], additionalProperties: false };
    }
    case "array": {
      if (!Number.isInteger(s.maxItems) || s.maxItems < 0) refuse();
      const grammar: Record<string, unknown> = { type: "array", items: toGrammarSchema(s.items, depth + 1), maxItems: s.maxItems };
      if (s.minItems !== undefined) {
        if (!Number.isInteger(s.minItems) || s.minItems < 0 || s.minItems > s.maxItems) refuse();
        grammar.minItems = s.minItems;
      }
      return grammar;
    }
    case "string":
      if (Array.isArray(s.enum)) {
        if (s.enum.length === 0 || !s.enum.every((value: unknown) => typeof value === "string")) refuse();
        return { enum: [...s.enum] };
      }
      if (!Number.isInteger(s.maxLength) || s.maxLength < 0) refuse();
      return { type: "string", maxLength: s.maxLength };
    case "integer":
    case "number":
      return { type: s.type };
    case "boolean":
      return { type: "boolean" };
    default:
      return refuse();
  }
}

/** The host's Qwen3.5 ChatML template with thinking pre-closed (`TEMPLATE` in `ai-host.cjs`). */
export const CHAT_TEMPLATE = Object.freeze({
  systemOpen: "<|im_start|>system\n",
  userOpen: "<|im_end|>\n<|im_start|>user\n",
  assistantOpen: "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
});

/** Host request limits mirrored from `ai-host.cjs` / `AiHostProtocol.ts`. */
export const HOST_LIMITS = Object.freeze({
  contextTokens: 4_096,
  maxPromptTokens: 3_072,
  batchSize: 512,
  temperature: 0,
  seed: 0
});

/**
 * The pre-registered L1.8 ceiling this bundle reports against, copied from
 * `scripts/benchmark-ai-model.mts` (`CEILINGS.backgroundJobAtCapMs`). Background jobs — the locator
 * semantic upgrade among them — are asynchronous, so the ceiling is the worst case AT THE OUTPUT CAP,
 * not the wall time of whatever the model happened to emit.
 */
export const BACKGROUND_JOB_AT_CAP_MS = 180_000;
