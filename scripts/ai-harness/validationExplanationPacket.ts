/**
 * The L1.8 `validationExplanation` workload: the product's own request, not a stand-in for it.
 *
 * `bench.ts` used to measure a synthetic packet written with the harness (9c252885), before L4b built
 * the feature (510bdbe2). Two of its three DATA blocks were validator messages and flow text — the two
 * things `buildAuthoringRequest` is designed never to send — and its nonce was twice the length
 * `AiService` generates. The explanation ceiling was being judged on a request the product never makes.
 *
 * This packet is built the way `app/main/ai/aiAssist.ts#explainFlowValidation` builds its job: the real
 * `FlowValidator` over a broken flow, then `buildAuthoringRequest` and `AUTHORING_LIMITS`. The flow has
 * casing-only mistakes on two conditional connectors, so the issues sent first all carry a fix marker,
 * the longest line the builder writes: the ceiling is a worst case, so the packet is one too.
 *
 * Electron-free, so the launcher can compute `identity` and measure the scenario again whenever the
 * product's request changes, instead of judging a new request by an old one's numbers.
 */

import { createHash } from "node:crypto";

import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { AUTHORING_LIMITS, buildAuthoringRequest, parseAuthoringAnswer } from "@src/ai/authoringExplanation";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { validateFlowDefinition, type FlowValidationCode } from "@src/validation/FlowValidator";

/** The length `AiService` generates (`randomBytes(8)`, 16 hex), fixed so the prompt is byte-identical per run. */
const NONCE = "0f1e2d3c4b5a6978";

const casingMistakes = { sourceField: "Outcome", operator: "NotEquals", expectedValue: "rejected" };
/** Also sent through the product path by `verify:ai-explanation-live`, so its time compares with this one. */
export const FLOW = {
  id: "bench-order-approval",
  name: "Order approval",
  version: 1,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "review", type: "click", name: "Open review", locator: { strategy: "testId", value: "review" } },
    { id: "approve", type: "click", name: "Approve order", locator: { strategy: "testId", value: "approve" } },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "e0", source: "start", target: "review", type: "success" },
    { id: "e1", source: "review", target: "approve", type: "conditional", kind: "conditional", conditional: casingMistakes },
    { id: "e2", source: "review", target: "end", type: "success" },
    { id: "e3", source: "approve", target: "end", type: "conditional", kind: "conditional", conditional: casingMistakes }
  ]
} as unknown as FlowProfile;

/**
 * What an explanation of each fixture issue has to name. One that explains an operator issue without
 * saying "operator" has not explained that issue. A proxy, kept as a count: model text is never recorded.
 */
const SUBJECT: Partial<Record<FlowValidationCode, RegExp>> = {
  unsupportedOperator: /operator/i,
  unsupportedConfiguration: /source|setting|configur|value|field/i,
  incompleteBranchPair: /connector|branch|condition|way out/i
};

export function validationExplanationPacket() {
  const request = buildAuthoringRequest(validateFlowDefinition(FLOW));
  if (!request) throw new Error("the benchmark flow produced no validation issues");
  const prompt = buildAiPrompt(request.prompt, new SemanticRedactor(), NONCE);
  if (!prompt.ok || prompt.omittedFields.length > 0) throw new Error("the product's explanation request did not build whole");
  const maxOutputTokens = AUTHORING_LIMITS.maxOutputTokens;
  const identity = createHash("sha256").update(JSON.stringify({ system: prompt.system, user: prompt.user, schema: request.schema, maxOutputTokens })).digest("hex");
  return {
    name: "validationExplanation" as const,
    spec: request.prompt,
    schema: request.schema,
    maxOutputTokens,
    nonce: NONCE,
    identity,
    /** The product's own verdict on a decoded answer, as counts and codes. */
    assess(value: unknown): Record<string, unknown> {
      const answer = parseAuthoringAnswer(value, request);
      if (!answer.ok) return { accepted: false, rejection: answer.code, field: answer.field };
      return {
        accepted: true,
        sent: request.issues.length,
        truncated: request.truncated,
        explained: answer.explanations.length,
        onSubject: answer.explanations.filter((e) => SUBJECT[e.issue.code]?.test(e.text) ?? false).length,
        textChars: answer.explanations.map((e) => e.text.length),
        ranked: answer.ranking.length,
        residualSecrets: answer.explanations.reduce((n, e) => n + findResidualSecrets(e.text).length, 0)
      };
    }
  };
}
