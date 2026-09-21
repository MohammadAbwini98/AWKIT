/**
 * verify:ai-fragment-assist — Phase L L6 *Intelligence*: deterministic fragment discovery, the T0
 * summary, and the T1 parameter-mapping suggestion.
 *
 * Real layers: the real `captureFragment` and `auditFragment` (so every fixture fragment is one the
 * product would actually store), the real `AiService` with the real `AiOutputContract` over
 * `FakeAiHostTransport`, and the real `AiAutonomyPolicy`.
 *
 * What makes it fail: a "similar fragment" hint that needs a model or an index; a hint that depends
 * on step names, locators or typed values rather than shape; a summary or a mapping request carrying
 * the user's own content; a mapping onto a key either side does not declare; two fragment inputs
 * aliased onto one workflow input; a type mismatch accepted because the model sounded sure; a
 * password input offered or accepted as a mapping target; or either feature applying anything.
 *
 * Run: npm run verify:ai-fragment-assist
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiService, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  FRAGMENT_ASSIST_LIMITS,
  buildFragmentSummaryRequest,
  buildParameterMappingRequest,
  findSimilarFragments,
  fragmentSummaryDecision,
  parameterMappingDecision,
  parseFragmentSummary,
  parseParameterMapping,
  type ParameterMappingRequest
} from "@src/ai/fragmentAssist";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { auditFragment, type FlowFragment } from "@src/fragments/FlowFragment";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { WorkflowRuntimeInput } from "@src/profiles/WorkflowProfile";
import type { AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";

import { summarizeFragment, type FragmentAssistDeps } from "../app/main/ai/aiAssist";

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

const work = await mkdtemp(join(tmpdir(), "awkit-l6i-"));
const MODEL_ROOT = resolvePath(join(work, "models"));

const IDLE: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "healthy",
  dispatchBlocked: false,
  activeWeight: 0,
  weightedBudget: 4,
  freeMemoryMb: 8_000
};
const POLICY = { enabled: true, featureTiers: {} } as const;

function harness(script: Array<FakeInferStep | string>) {
  const fake = new FakeAiHostTransport({ modelRoot: MODEL_ROOT, respond: (_r, index) => script[Math.min(index, script.length - 1)] ?? "{}" });
  const service = new AiService({
    transport: () => fake,
    model: async () => ({ ok: true, modelId: "fake-l6-model", modelPath: join(MODEL_ROOT, "model.gguf"), contextTokens: 8192 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 } as AiServiceSettings),
    admission: () => IDLE,
    threads: 2,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10 },
    nonce: () => "0123456789abcdef"
  });
  return { fake, service };
}

// Distinctive strings that must never leave the machine: a fragment is captured verbatim from a real
// flow, so its names and typed values are the user's own business content.
const SECRET_NAME = "Wombat-Marmot-StepName";
const SECRET_VALUE = "Wombat-Marmot-TypedValue";
const SECRET_LOCATOR = "Wombat-Marmot-Selector";

const step = (id: string, type: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, type, name: `${type} ${id}`, ...extra }) as FlowStep;

/** A fragment built the way the product builds one, and audited so it really is storable. */
function fragment(id: string, name: string, nodes: FlowStep[], inputs: FlowFragment["inputs"] = []): FlowFragment {
  const value: FlowFragment = { id, name, kind: inputs.length ? "template" : "fragment", version: 1, nodes, edges: [], inputs };
  const findings = auditFragment(value).filter((finding) => finding.severity === "blocking");
  if (findings.length > 0) throw new Error(`fixture ${id} is not a storable fragment: ${findings.map((f) => f.code).join(",")}`);
  return value;
}

const loginNodes = [
  step("a", "fill", { name: SECRET_NAME, value: SECRET_VALUE, locator: { strategy: "css", value: SECRET_LOCATOR } }),
  step("b", "fill"),
  step("c", "click")
];
// Two TEXT inputs on purpose. The duplicate rules must be provable on their own: with only one text
// input, "two inputs aliased onto one workflow input" is also a type mismatch, and a mutation test
// showed the type rule shadowing the alias rule — the alias check would have gone untested.
const loginFragment = fragment("frag-login", "Sign in and continue", loginNodes, [
  { key: "userName", label: "User name", type: "text", required: true },
  { key: "displayName", label: "Display name", type: "text", required: false },
  { key: "retryCount", label: "Retry count", type: "number", required: false }
]);
const reorderedLogin = [step("x", "click"), step("y", "fill"), step("z", "fill")];
const searchFragment = fragment("frag-search", "Search the catalogue", [step("d", "fill"), step("e", "click"), step("f", "assertText"), step("g", "extractText")]);
const unrelatedFragment = fragment("frag-upload", "Upload a file", [step("h", "upload"), step("i", "wait")]);

// ── 0. The fixtures are the product's own ───────────────────────────────────────────────────────
console.log("\n0 — the fixtures are fragments the product would really store");
check("the login fragment audits clean", auditFragment(loginFragment).every((f) => f.severity !== "blocking"));
check("...and declares three inputs, two of them the same type", loginFragment.inputs.length === 3 && loginFragment.inputs.filter((i) => i.type === "text").length === 2);
check("the search and upload fragments audit clean too", [searchFragment, unrelatedFragment].every((f) => auditFragment(f).every((x) => x.severity !== "blocking")));

// ── 1. Discovery is deterministic, and needs no model ───────────────────────────────────────────
console.log("\n1 — the passive 'a similar fragment exists' hint");
const library = [loginFragment, searchFragment, unrelatedFragment];
const hints = findSimilarFragments(loginNodes, library);
check("the identical subgraph finds its own fragment", hints[0]?.fragmentId === "frag-login", JSON.stringify(hints));
check("...at similarity 1", hints[0]?.similarity === 1);
check("...and the unrelated fragment is not offered", !hints.some((hint) => hint.fragmentId === "frag-upload"), JSON.stringify(hints));
// The whole point of comparing SHAPE: two authors order a fill pair either way round.
const reordered = findSimilarFragments(reorderedLogin, library);
check("the same steps in a DIFFERENT order still match", reordered[0]?.fragmentId === "frag-login" && reordered[0]?.similarity === 1, JSON.stringify(reordered));
// And the hint must not depend on the user's own words.
const renamed = loginNodes.map((node) => ({ ...node, name: "totally different name", value: "different value" }) as FlowStep);
check("renaming every step changes nothing, because names are never compared", JSON.stringify(findSimilarFragments(renamed, library)) === JSON.stringify(hints));
const partial = findSimilarFragments([step("p", "fill"), step("q", "click")], library);
check("a partial overlap scores below 1 but is still offered", partial[0]?.fragmentId === "frag-login" && partial[0].similarity < 1 && partial[0].similarity >= FRAGMENT_ASSIST_LIMITS.minSimilarity, JSON.stringify(partial));
check("...reporting how many steps it shares", partial[0]?.sharedSteps === 2);
check("a subgraph with nothing in common gets no hint", findSimilarFragments([step("r", "oracleQuery"), step("s", "runFlow")], library).length === 0);
check("an empty selection gets no hint", findSimilarFragments([], library).length === 0);
check("an empty library gets no hint", findSimilarFragments(loginNodes, []).length === 0);
const many = Array.from({ length: 10 }, (_, i) => fragment(`f-${i}`, `Fragment ${i}`, loginNodes.map((n, j) => step(`${i}-${j}`, n.type))));
check("hints are capped", findSimilarFragments(loginNodes, many).length === FRAGMENT_ASSIST_LIMITS.maxHints);
check("...and stably ordered, so the hint does not reshuffle while it is read", JSON.stringify(findSimilarFragments(loginNodes, many)) === JSON.stringify(findSimilarFragments(loginNodes, many)));

// ── 2. The summary (T0) ─────────────────────────────────────────────────────────────────────────
console.log("\n2 — the T0 summary");
const summaryRequest = buildFragmentSummaryRequest(loginFragment)!;
check("a request is built", summaryRequest !== undefined);
const summaryPrompt = buildAiPrompt(summaryRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
if (!summaryPrompt.ok) throw new Error(`the summary prompt did not build: ${summaryPrompt.code} ${summaryPrompt.detail}`);
const summaryText = `${summaryPrompt.system}\n${summaryPrompt.user}`;
check("the step name never reaches the prompt", !summaryText.includes(SECRET_NAME));
check("the typed value never reaches the prompt", !summaryText.includes(SECRET_VALUE));
check("the locator value never reaches the prompt", !summaryText.includes(SECRET_LOCATOR));
check("the step TYPES do, which is what a summary needs", summaryText.includes("fill") && summaryText.includes("click"));
check("...as do the input keys", summaryText.includes("userName"));

const h = harness(['{"version":1,"summary":"Signs in with a user name and continues to the next page."}']);
const summaryOutcome = await h.service.submit({
  requestId: "l6-summary",
  feature: "fragmentSummary",
  priority: "interactive",
  prompt: summaryRequest.prompt,
  schema: summaryRequest.schema,
  maxOutputTokens: FRAGMENT_ASSIST_LIMITS.maxOutputTokens,
  timeoutMs: FRAGMENT_ASSIST_LIMITS.timeoutMs
});
check("the summary job completes", summaryOutcome.status === "ok", JSON.stringify(summaryOutcome));
const summary = summaryOutcome.status === "ok" ? parseFragmentSummary(summaryOutcome.value) : undefined;
check("...and parses", summary?.ok === true && summary.summary.startsWith("Signs in"), JSON.stringify(summary));
await h.service.shutdown();

check("an empty summary is refused", (parseFragmentSummary({ version: 1, summary: "  " }) as { code?: string }).code === "EMPTY_SUMMARY");
check("control characters are refused", (parseFragmentSummary({ version: 1, summary: `a${String.fromCharCode(7)}b` }) as { code?: string }).code === "UNSAFE_TEXT");
check("an over-long summary is refused", (parseFragmentSummary({ version: 1, summary: "x".repeat(FRAGMENT_ASSIST_LIMITS.maxSummaryChars + 1) }) as { code?: string }).code === "MALFORMED");
check("a wrong version is refused", (parseFragmentSummary({ version: 2, summary: "ok" }) as { code?: string }).code === "MALFORMED");
check("a fragment with no steps has nothing to summarize", buildFragmentSummaryRequest({ ...loginFragment, nodes: [] }) === undefined);

// ── 3. Parameter mapping (T1) ───────────────────────────────────────────────────────────────────
console.log("\n3 — the T1 parameter-mapping suggestion");
const workflowInputs: WorkflowRuntimeInput[] = [
  { key: "operatorName", label: "Operator name", type: "text", required: true },
  { key: "secondName", label: "Second name", type: "text", required: false },
  { key: "attempts", label: "Attempts", type: "number", required: false },
  { key: "isDryRun", label: "Dry run", type: "checkbox", required: false },
  { key: "operatorPassword", label: "Operator password", type: "password", required: true }
];
const mappingRequest = buildParameterMappingRequest(loginFragment, workflowInputs) as ParameterMappingRequest;
check("a request is built", mappingRequest !== undefined);
// A credential is never a mapping target, so the model is never shown one.
check("the password input is excluded from the request entirely", !mappingRequest.workflowInputs.some((input) => input.type === "password"), JSON.stringify(mappingRequest.workflowInputs.map((i) => i.key)));
const mappingPrompt = buildAiPrompt(mappingRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
if (!mappingPrompt.ok) throw new Error(`the mapping prompt did not build: ${mappingPrompt.code} ${mappingPrompt.detail}`);
check("...and from the prompt", !`${mappingPrompt.system}\n${mappingPrompt.user}`.includes("operatorPassword"));
const workflowEnum = (mappingRequest.schema as { properties: Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }> }).properties.mappings.items!.properties!.workflowInputKey.enum;
check("the workflow key enum omits it too, so the grammar cannot emit it", !workflowEnum!.includes("operatorPassword"), JSON.stringify(workflowEnum));
check("no fragment with no inputs gets a mapping request", buildParameterMappingRequest({ ...loginFragment, inputs: [] }, workflowInputs) === undefined);
check("no workflow with only a password input gets one either", buildParameterMappingRequest(loginFragment, [workflowInputs[4]]) === undefined);

const goodMapping = parseParameterMapping(
  {
    version: 1,
    mappings: [
      { fragmentInputKey: "userName", workflowInputKey: "operatorName" },
      { fragmentInputKey: "displayName", workflowInputKey: "secondName" },
      { fragmentInputKey: "retryCount", workflowInputKey: "attempts" }
    ]
  },
  mappingRequest
);
check("a well-typed mapping is accepted", goodMapping.ok === true, JSON.stringify(goodMapping));
if (goodMapping.ok) {
  check("...with every pair", goodMapping.mappings.length === 3);
  check("...and nothing left unmapped", goodMapping.unmapped.length === 0);
}
const partialMapping = parseParameterMapping({ version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "operatorName" }] }, mappingRequest);
check("leaving an input unmapped is a correct answer", partialMapping.ok === true && partialMapping.unmapped.join(",") === "displayName,retryCount", JSON.stringify(partialMapping));
const emptyMapping = parseParameterMapping({ version: 1, mappings: [] }, mappingRequest);
check("mapping nothing at all is a correct answer", emptyMapping.ok === true && emptyMapping.mappings.length === 0 && emptyMapping.unmapped.length === 3);

const mappingRefusals: Array<[string, unknown, string, string]> = [
  [
    "a fragment key the fragment does not declare is refused",
    { version: 1, mappings: [{ fragmentInputKey: "nope", workflowInputKey: "operatorName" }] },
    "UNKNOWN_FRAGMENT_INPUT",
    "mappings.0.fragmentInputKey"
  ],
  [
    "a workflow key the workflow does not declare is refused",
    { version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "nope" }] },
    "UNKNOWN_WORKFLOW_INPUT",
    "mappings.0.workflowInputKey"
  ],
  [
    "a password target is refused even if it somehow reaches the parse",
    { version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "operatorPassword" }] },
    "UNKNOWN_WORKFLOW_INPUT",
    "mappings.0.workflowInputKey"
  ],
  // Both duplicate cases use TYPE-COMPATIBLE pairs, so only the duplicate rule can catch them. With a
  // mismatched pair the type rule fires first and the duplicate rule goes untested — which is exactly
  // what a mutation run showed before this fixture gained a second text input.
  [
    "the same fragment input mapped twice is refused",
    { version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "operatorName" }, { fragmentInputKey: "userName", workflowInputKey: "secondName" }] },
    "DUPLICATE_MAPPING",
    "mappings.1.fragmentInputKey"
  ],
  [
    "two fragment inputs aliased onto ONE workflow input is refused",
    { version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "operatorName" }, { fragmentInputKey: "displayName", workflowInputKey: "operatorName" }] },
    "DUPLICATE_MAPPING",
    "mappings.1.workflowInputKey"
  ],
  [
    "a type mismatch is refused, however confident the answer",
    { version: 1, mappings: [{ fragmentInputKey: "retryCount", workflowInputKey: "isDryRun" }] },
    "TYPE_MISMATCH",
    "mappings.0.workflowInputKey"
  ],
  ["a non-array mappings field is refused", { version: 1, mappings: "all of them" }, "MALFORMED", "mappings"],
  ["a wrong version is refused", { version: 7, mappings: [] }, "MALFORMED", "version"],
  ["a non-object answer is refused", 42, "MALFORMED", "$"]
];
for (const [label, value, code, field] of mappingRefusals) {
  const result = parseParameterMapping(value, mappingRequest);
  check(label, !result.ok && result.code === code && result.field === field, JSON.stringify(result));
}

// The password target is refused as UNKNOWN because the request excluded it. Prove the CREDENTIAL_TARGET
// branch is reachable too, so the second line of defence is not dead code.
const leaky: ParameterMappingRequest = { ...mappingRequest, workflowInputs };
const credential = parseParameterMapping({ version: 1, mappings: [{ fragmentInputKey: "userName", workflowInputKey: "operatorPassword" }] }, leaky);
check("...and a request that DID include a password still refuses it as a credential target", !credential.ok && credential.code === "CREDENTIAL_TARGET", JSON.stringify(credential));

// ── 4. A model that tries to bind rather than suggest ───────────────────────────────────────────
console.log("\n4 — neither feature applies anything");
const schemaText = JSON.stringify(mappingRequest.schema);
check("the mapping schema has no field for a value", !/"value"|defaultValue/.test(schemaText));
check("...and none for applying or binding", !/apply|bind|commit/i.test(schemaText));
const binding = harness(['{"version":1,"mappings":[],"apply":true,"boundValues":{"userName":"alice"}}']);
const bindingOutcome = await binding.service.submit({
  requestId: "l6-binding",
  feature: "fragmentParameterMapping",
  priority: "interactive",
  prompt: mappingRequest.prompt,
  schema: mappingRequest.schema,
  maxOutputTokens: FRAGMENT_ASSIST_LIMITS.maxOutputTokens,
  timeoutMs: FRAGMENT_ASSIST_LIMITS.timeoutMs
});
check("an answer trying to apply or supply a value is refused by the output contract", bindingOutcome.status === "failed" && bindingOutcome.code === "SCHEMA_REJECTED", JSON.stringify(bindingOutcome));
check("...and no value reaches the caller", !("value" in bindingOutcome));
await binding.service.shutdown();

// ── 5. Tiers, and AI absence ────────────────────────────────────────────────────────────────────
console.log("\n5 — tiers");
const summaryTier = fragmentSummaryDecision(POLICY);
check("a summary is T0 observe", summaryTier.decision === "observe" && summaryTier.tier === "T0", JSON.stringify(summaryTier));
const mappingTier = parameterMappingDecision(POLICY);
check("a mapping is T1 suggest — never autoApply", mappingTier.decision === "suggest" && mappingTier.tier === "T1", JSON.stringify(mappingTier));
check("configuration cannot raise the mapping to auto-apply", parameterMappingDecision({ enabled: true, featureTiers: { fragmentParameterMapping: "T2" } }).decision === "suggest");
check("configuration cannot raise the summary above observe", fragmentSummaryDecision({ enabled: true, featureTiers: { fragmentSummary: "T2" } }).decision === "observe");
check("the master switch off forbids both", fragmentSummaryDecision({ enabled: false }).decision === "forbidden" && parameterMappingDecision({ enabled: false }).decision === "forbidden");
// Discovery is the one piece that must keep working with no AI at all.
check("but discovery still works with AI switched off, because it never needed a model", findSimilarFragments(loginNodes, library).length > 0);

// ── The main-process adapter behind ai:summarizeFragment ────────────────────────────────────────
// `app/main/ai/aiAssist.ts#summarizeFragment` is what the IPC channel calls: the renderer names a
// fragment, main reads the STORED one and asks the real AiService. Every negative below is production.
console.log("\nmain — the adapter behind ai:summarizeFragment");
const store = new Map([[loginFragment.id, loginFragment]]);
const fragmentDeps = (service: AiService, policy: AiPolicyConfig = POLICY): FragmentAssistDeps => ({
  submit: (job) => service.submit(job),
  policy: async () => policy,
  fragment: async (id) => store.get(id) ?? null
});
const good = harness(['{"version":1,"summary":"Fills two fields and continues."}']);
const summaryView = await summarizeFragment(3, { requestId: "ui-1", fragmentId: loginFragment.id }, fragmentDeps(good.service));
check("a named fragment is summarized", summaryView.ok && summaryView.summary === "Fills two fields and continues.", JSON.stringify(summaryView));
check("...for the fragment that was named", summaryView.fragmentId === loginFragment.id);
const sentText = good.fake.inferRequests().map((r) => `${r.system}\n${r.user}`).join("\n");
check("the IPC path sends no step name, typed value or locator", ![SECRET_NAME, SECRET_VALUE, SECRET_LOCATOR].some((s) => sentText.includes(s)));
check("...but does send the step types it describes", sentText.includes("fill") && sentText.includes("click"));
// A renderer that sends its own fragment body is ignored: only the id is read, and the store answers.
const forged = await summarizeFragment(3, { requestId: "ui-2", fragmentId: loginFragment.id, fragment: { nodes: [step("z", "upload", { name: SECRET_NAME })] } }, fragmentDeps(good.service));
check("a fragment body sent by the renderer is never used", forged.ok && !good.fake.inferRequests().some((r) => r.user.includes("upload")));
await good.service.shutdown();

const quiet = harness(['{"version":1,"summary":"x"}']);
const calls = () => quiet.fake.inferRequests().length;
check("AI switched off answers DISABLED", (await summarizeFragment(3, { requestId: "ui-3", fragmentId: loginFragment.id }, fragmentDeps(quiet.service, { enabled: false }))).code === "DISABLED");
check("a fragment that no longer exists answers NOT_FOUND", (await summarizeFragment(3, { requestId: "ui-4", fragmentId: "frag-gone" }, fragmentDeps(quiet.service))).code === "NOT_FOUND");
for (const [label, input] of [
  ["a non-object request", "frag-login"],
  ["a missing request id", { fragmentId: loginFragment.id }],
  ["a fragment id with a path separator", { requestId: "ui-5", fragmentId: "..\\frag-login" }],
  ["a request id with a path separator", { requestId: "a/b", fragmentId: loginFragment.id }]
] as Array<[string, unknown]>) {
  check(`${label} is refused as INVALID_REQUEST`, (await summarizeFragment(3, input, fragmentDeps(quiet.service))).code === "INVALID_REQUEST");
}
check("...and none of those refusals reached the model", calls() === 0, String(calls()));
await quiet.service.shutdown();

const unsafe = harness([`{"version":1,"summary":"MODEL-TEXT${String.fromCharCode(7)}here"}`]);
const unsafeView = await summarizeFragment(3, { requestId: "ui-6", fragmentId: loginFragment.id }, fragmentDeps(unsafe.service));
check("a summary with control characters is OUTPUT_REJECTED", !unsafeView.ok && unsafeView.code === "OUTPUT_REJECTED" && unsafeView.summary === null, JSON.stringify(unsafeView));
check("...and none of its text reaches the renderer", !JSON.stringify(unsafeView).includes("MODEL-TEXT"));
await unsafe.service.shutdown();

console.log(`\nL6 fragment intelligence: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
