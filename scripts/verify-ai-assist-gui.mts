/**
 * verify:ai-assist-gui — the L4b authoring assist, the L5b failure analysis and the L6 fragment
 * surfaces in the REAL Electron app.
 *
 * `verify:ai-authoring` and `verify:ai-fragment-assist` prove the contracts and the main-process
 * adapters in Node; this proves the parts that only exist once the app runs: the Flow Designer sending
 * its open flow over real IPC, main re-validating it and answering through the production `AiService`,
 * the answer rendered labelled under the finding it belongs to, a stale answer withheld after an edit,
 * cancellation reaching main, a refused answer shown as a refusal, AI switched off leaving validation
 * intact, the insert dialog describing a STORED fragment on demand, the save dialog's no-model
 * similarity hint following the selection with AI off, a seeded failed run's evidence, deterministic
 * cause and on-demand analysis in the run-detail drawer — saved with the run's report, shown again on
 * reopening, and deletable with AI off back to the report the run wrote — and no flow or fragment on
 * disk touched by any of it.
 *
 * The provider is the DETERMINISTIC one: `AWKIT_TEST_AI_PROVIDER` names a file holding the next
 * scripted answer, read only by a non-packaged build (the `AWKIT_TEST_LICENSE_BYPASS` pattern). It
 * replaces the transport and the model pack; queue, prompt builder and output contract are production.
 * A pass here says nothing about live-model quality or latency (L1.8 still FAILS).
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-assist-gui
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type Page } from "playwright";

import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import type { FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { auditFragment, type FlowFragment } from "@src/fragments/FlowFragment";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { EvidenceBuffer, EvidenceRunBudget } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import type { DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

import {
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
  // @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  navClick,
  watchConsole
  // @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = isolatedLaunchEnv("awkit-ai-assist-gui");
const providerFile = path.join(probe.dataRoot, "test-ai-provider.json");
const { env, electronArgs, dataRoot, cleanup } = { ...probe, env: { ...probe.env, AWKIT_TEST_AI_PROVIDER: providerFile } };
const appData = path.join(dataRoot, "SpecterStudio");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string | null): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Seed: AI on, one flow with an unfixable finding and a validator-fixable one ───────────────────
const FLOW_ID = "l4b-assist-gui";
const FLOW_NAME = "L4b assist GUI";
const STEP_NAME = "Zebra-Quokka-Step";
const flowFile = path.join(appData, "flows", `${FLOW_ID}.json`);
const now = new Date().toISOString();
const seededFlow = {
  id: FLOW_ID,
  name: FLOW_NAME,
  description: "Seeded for verify:ai-assist-gui",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
    // No locator: missingRequiredLocator, which no safe fix can repair.
    { id: "click", type: "click", name: STEP_NAME, position: { x: 280, y: 220 } },
    { id: "fill", type: "fill", name: "Fill name", value: "Zebra-Quokka-Typed", locator: { strategy: "css", value: "#zebra-quokka" }, position: { x: 280, y: 360 } },
    { id: "end", type: "end", name: "End", position: { x: 280, y: 500 } }
  ],
  edges: [
    { id: "e0", source: "start", target: "click", type: "success" },
    { id: "e1", source: "click", target: "fill", type: "success" },
    // Casing-only enum mistakes: the validator emits normalizeEnumCasing fixes for these.
    { id: "e-cond", source: "fill", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "Outcome", operator: "NotEquals", expectedValue: "fail" } }
  ]
} as unknown as FlowProfile;

mkdirSync(path.join(appData, "flows"), { recursive: true });
mkdirSync(path.join(appData, "ai"), { recursive: true });
writeFileSync(flowFile, `${JSON.stringify(seededFlow, null, 2)}\n`, "utf8");
const aiSettings = (enabled: boolean) =>
  writeFileSync(path.join(appData, "ai", "ai-settings.json"), `${JSON.stringify({ enabled, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: {} }, null, 2)}\n`, "utf8");
aiSettings(true);

// The ids main will assign, derived from the same validator over the same flow. If the designer's
// round trip ever changed the report, the explanation-placement checks below fail rather than pass.
const expected = buildAuthoringRequest(validateFlowDefinition(seededFlow, { referenceableFlowIds: new Set([FLOW_ID]) }));
if (!expected) throw new Error("the seeded flow produced no findings");
const ids = expected.issues.map((ref) => ref.id);
const provide = (step: FakeInferStep) => writeFileSync(providerFile, JSON.stringify(step), "utf8");
const goodAnswer = JSON.stringify({
  version: 1,
  explanations: ids.map((id) => ({ issueId: id, text: `EXPL-${id}: look at this step's settings.` })),
  ranking: expected.fixableIds
});
provide({ text: goodAnswer });

// L6: one stored fragment with the same step SHAPE (fill + click) as two of the flow's steps.
const FRAGMENT_ID = "l6-fill-click";
const FRAGMENT_NAME = "Fill then click";
const fragmentFile = path.join(appData, "fragments", `${FRAGMENT_ID}.json`);
const seededFragment: FlowFragment = {
  id: FRAGMENT_ID,
  name: FRAGMENT_NAME,
  kind: "fragment",
  version: 1,
  nodes: [
    { id: "fa", type: "fill", name: "Wombat-Fragment-Step", value: "Wombat-Fragment-Typed", locator: { strategy: "css", value: "#wombat" } },
    { id: "fb", type: "click", name: "Go", locator: { strategy: "testId", value: "go" } }
  ],
  edges: [{ id: "fe", source: "fa", target: "fb", type: "success" }],
  inputs: []
} as FlowFragment;
const fragmentBlocking = auditFragment(seededFragment).filter((finding) => finding.severity === "blocking");
if (fragmentBlocking.length) throw new Error(`the seeded fragment is not storable: ${fragmentBlocking.map((f) => f.code).join(",")}`);
mkdirSync(path.dirname(fragmentFile), { recursive: true });
writeFileSync(fragmentFile, `${JSON.stringify(seededFragment, null, 2)}\n`, "utf8");

// L5b: one stored failed run whose diagnostics come from L5a's REAL buffer and REAL cause baseline,
// plus a second instance failing the same way, and the durable history row the drawer opens from.
const RUN_EXEC = "exec-l5b-gui";
const RUN_ID = "run-l5b-gui";
function capturedFailure(instanceId: string): InstanceDiagnostics {
  let clock = 0;
  const buffer = new EvidenceBuffer({ executionId: RUN_EXEC, instanceId }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
  const step = { flowId: "flow-l5b-gui", nodeId: "n-submit", stepIndex: 2 };
  clock = 1_000;
  buffer.add({ source: "http.error", severity: "error", context: step, payload: { method: "POST", url: "https://shop.example/orders/40001/submit?token=gui-secret-token", status: 500, resourceType: "xhr" } });
  clock = 1_500;
  buffer.add({ source: "runner.failure", severity: "error", context: step, payload: { kind: "assertion", message: "The order confirmation did not appear." } });
  const evidence = [...buffer.list()];
  const runnerEvent = evidence.find((event) => event.source === "runner.failure");
  const cause = deriveFailureCause(evidence, { kind: "assertion", stepStartOffsetMs: 500, failedAtOffsetMs: 1_500, ...(runnerEvent ? { evidenceId: runnerEvent.id } : {}) });
  return { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence, summary: buffer.summary(), cause };
}
const runDiagnostics = capturedFailure(RUN_ID);
if (!runDiagnostics.cause || runDiagnostics.cause.evidenceIds.length === 0) throw new Error("the seeded failure has no evidenced cause");
const reportFile = path.join(appData, "reports", `${RUN_EXEC}.json`);
const failedAt = Date.now() - 10 * 60_000;
const storedRun: ConcurrentRunReport & { id: string } = {
  id: RUN_EXEC,
  executionId: RUN_EXEC,
  scenarioId: "wf-l5b-gui",
  scenarioName: "L5b GUI workflow",
  runMode: "dataDrivenConcurrent",
  maxConcurrentInstances: 2,
  status: "failed",
  startedAt: new Date(failedAt).toISOString(),
  endedAt: new Date(failedAt + 3_000).toISOString(),
  durationMs: 3_000,
  passedFlows: 0,
  failedFlows: 2,
  skippedFlows: 0,
  instances: [RUN_ID, `${RUN_ID}-row2`].map((instanceId) => ({
    instanceId,
    status: "failed" as const,
    durationMs: 1_500,
    error: "The order confirmation did not appear.",
    screenshots: [],
    downloadedFiles: [],
    diagnostics: instanceId === RUN_ID ? runDiagnostics : capturedFailure(instanceId)
  })),
  runtimeInputs: {}
};
mkdirSync(path.dirname(reportFile), { recursive: true });
writeFileSync(reportFile, `${JSON.stringify(storedRun, null, 2)}\n`, "utf8");
mkdirSync(path.join(appData, "runtime"), { recursive: true });
{
  const runtime = await SqliteRuntimeStore.open(path.join(appData, "runtime", "runtime.sqlite"), () => undefined);
  const iso = (ms: number) => new Date(ms).toISOString();
  runtime.upsertRun({
    instanceId: RUN_ID,
    executionId: RUN_EXEC,
    scenarioId: "wf-l5b-gui",
    scenarioName: "L5b GUI workflow",
    triggerType: "manual",
    status: "failed",
    flowRunStatus: "failed",
    startedAt: iso(failedAt),
    endedAt: iso(failedAt + 1_500),
    updatedAt: iso(failedAt + 1_500),
    durationMs: 1_500,
    queueWaitMs: 10,
    retryCount: 0,
    reportCategory: "assertion",
    errorClass: "assertion",
    error: "The order confirmation did not appear.",
    machineId: "fixture-machine",
    logicalCpuCount: 8,
    totalMemoryMb: 8192,
    executionMode: "auto",
    browserPoolMode: "shared",
    configuredConcurrency: 2,
    observedPeakConcurrency: 2,
    workloadClass: "light",
    headed: false,
    resourceProfile: "balanced",
    isolationClass: "SHARED_CONTEXT",
    workloadWeight: 1,
    pressureStateAtRun: "healthy"
  } as Partial<DurableRunRecord> as DurableRunRecord);
  await runtime.persistNow();
  await runtime.close();
}

const digestOf = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fileDigest = () => digestOf(flowFile);
const seededDigest = fileDigest();
const seededFragmentDigest = digestOf(fragmentFile);

async function stateSettles(win: Page, testId: string, want: string, timeout = 20_000): Promise<string | null> {
  await win
    .waitForFunction(([id, value]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("data-assist-state") === value, [testId, want], { timeout })
    .catch(() => undefined);
  return win.getByTestId(testId).getAttribute("data-assist-state");
}

/** Findings whose explanation is missing or not under that finding's own row. */
async function misplacedExplanations(win: Page): Promise<string[]> {
  const placement = await win.evaluate(() =>
    [...document.querySelectorAll('[data-testid="ai-explanation"]')].map((node) => {
      let row = node.previousElementSibling;
      while (row && !row.classList.contains("validation-issue-row")) row = row.previousElementSibling;
      return { text: node.textContent ?? "", row: row?.textContent ?? "" };
    })
  );
  return expected!.issues
    .filter((ref) => {
      const entry = placement.find((p) => p.text.includes(`EXPL-${ref.id}:`));
      return !entry || !entry.row.includes(ref.issue.message);
    })
    .map((ref) => ref.id);
}

const bar = (win: Page) => win.getByTestId("ai-assist-bar");
async function assistSettles(win: Page, want: string, timeout = 20_000): Promise<string | null> {
  await win
    .waitForFunction((value) => document.querySelector('[data-testid="ai-assist-bar"]')?.getAttribute("data-assist-state") === value, want, { timeout })
    .catch(() => undefined);
  return bar(win).getAttribute("data-assist-state");
}

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  console.log("\nPreconditions");
  console.log(`  (fixture: ${expected.issues.length} findings, fixable ${JSON.stringify(expected.fixableIds)})`);
  check("the fixture has an unfixable finding AND a validator-fixable one", expected.fixableIds.length >= 1 && expected.issues.length > expected.fixableIds.length);
  const status = await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus());
  check("main reports local AI available through the deterministic provider", status.enabled && status.state === "available", JSON.stringify(status));

  console.log("\nThe designer offers the explanation inside the validation panel");
  console_.setLabel("flow designer");
  await navClick(win, "Flow Designer");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: FLOW_NAME }).click();
  await win.getByTestId("flow-validation-chip").click();
  await bar(win).waitFor({ state: "visible", timeout: 20_000 });
  const explainButton = win.getByTestId("ai-assist-explain");
  check("the AI bar is in the validation panel", (await win.getByTestId("flow-validation-panel").getByTestId("ai-assist-bar").count()) === 1);
  check("...idle, with no explanation shown before one is asked for", (await assistSettles(win, "idle")) === "idle" && (await win.getByTestId("ai-explanation").count()) === 0);
  check("...and Explain is an enabled, named button", (await explainButton.isEnabled()) && (await win.getByRole("button", { name: "Explain with AI" }).count()) === 1);

  console.log("\nA real answer is rendered labelled, under the finding it explains");
  await explainButton.click();
  const settled = await assistSettles(win, "done");
  check("the request completes through real IPC and the production AiService", settled === "done", `${settled} — ${await win.getByTestId("ai-assist-message").innerText().catch(() => "")}`);
  const explanations = win.getByTestId("ai-explanation");
  check("one explanation per finding", (await explanations.count()) === ids.length, String(await explanations.count()));
  check("each is labelled as an AI interpretation", (await explanations.allInnerTexts()).every((text) => text.startsWith("AI interpretation")));
  const misplaced = await misplacedExplanations(win);
  check("...and sits under the row of the validator issue it names", misplaced.length === 0, JSON.stringify(misplaced));
  const ranks = win.getByTestId("ai-fix-rank");
  check("the suggested fix order marks exactly the validator-fixable findings", (await ranks.count()) === expected.fixableIds.length, String(await ranks.count()));
  check("...and says nothing changes until the user confirms", /Nothing is changed until you review and confirm/.test(await win.getByTestId("ai-assist-ranking").innerText()));
  check("the saved flow is untouched by explaining it", fileDigest() === seededDigest);

  console.log("\nApplying still goes through the existing preview → confirm path");
  const review = win.getByTestId("ai-assist-review-fixes");
  check("Review safe fixes is offered for the saved, unedited flow", await review.isEnabled());
  await review.click();
  const preview = win.getByTestId("flow-fix-preview");
  await preview.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("it opens the deterministic fix preview, not an AI edit", (await preview.count()) === 1);
  await preview.getByRole("button", { name: "Cancel" }).click();
  check("cancelling the preview writes nothing", fileDigest() === seededDigest);

  console.log("\nAn edit withholds the now-stale answer");
  await win.locator(".action-flow-node", { hasText: STEP_NAME }).first().click();
  await win.locator(".properties-body").getByRole("textbox", { name: "Description" }).fill("Edited after the explanation");
  check("the bar reports the answer as stale", (await assistSettles(win, "stale")) === "stale");
  check("...and shows none of its explanations", (await explanations.count()) === 0 && (await ranks.count()) === 0);
  await win.getByTestId("ai-assist-explain").click();
  check("explaining again answers for the edited flow", (await assistSettles(win, "done")) === "done");
  check("...but fixes cannot be reviewed until it is saved", (await review.isDisabled()) && /Save the flow first/.test(await win.getByTestId("ai-assist-ranking").innerText()));
  check("the unsaved edit reached neither the saved flow nor anything else on disk", fileDigest() === seededDigest);

  console.log("\nAn answer slower than the old 30 s deadline is delivered and rendered");
  // Qwen3.5-0.8B answers in 70–76 s (L1.8). 31 s is past the deadline every feature used to share, so
  // a regression to it ends this request TIMEOUT instead.
  const SLOW_ANSWER_MS = 31_000;
  provide({ text: goodAnswer, delayMs: SLOW_ANSWER_MS });
  const slowStarted = Date.now();
  await win.getByTestId("ai-assist-explain").click();
  check("(precondition) the slow answer is pending", (await assistSettles(win, "loading")) === "loading");
  const slowSettled = await assistSettles(win, "done", SLOW_ANSWER_MS + 30_000);
  const slowMs = Date.now() - slowStarted;
  check(
    "an answer that takes longer than 30 s completes",
    slowSettled === "done" && slowMs >= SLOW_ANSWER_MS,
    `${slowSettled} after ${slowMs} ms — ${await win.getByTestId("ai-assist-message").innerText().catch(() => "")}`
  );
  check("...with one labelled explanation per finding", (await explanations.count()) === ids.length && (await explanations.allInnerTexts()).every((text) => text.startsWith("AI interpretation")), String(await explanations.count()));
  const slowMisplaced = await misplacedExplanations(win);
  check("...each under the finding it explains", slowMisplaced.length === 0, JSON.stringify(slowMisplaced));
  check("...and the bar reports them", new RegExp(`AI explained ${ids.length} finding`).test(await win.getByTestId("ai-assist-message").innerText()));

  console.log("\nCancellation reaches main");
  provide({ hang: true });
  await win.getByTestId("ai-assist-explain").click();
  check("a slow answer shows a loading state with Cancel", (await assistSettles(win, "loading")) === "loading" && (await win.getByTestId("ai-assist-cancel").isEnabled()));
  // Precondition for the cancel claim: main must actually be holding the job.
  let busy = false;
  for (let i = 0; i < 50 && !busy; i += 1) {
    busy = (await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus())).state === "busy";
    if (!busy) await win.waitForTimeout(100);
  }
  check("main is running the job", busy);
  await win.getByTestId("ai-assist-cancel").click();
  check("the bar reports it cancelled", (await assistSettles(win, "cancelled")) === "cancelled");
  let released = false;
  for (let i = 0; i < 50 && !released; i += 1) {
    const now = await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus());
    released = now.state !== "busy" && now.queueDepth === 0;
    if (!released) await win.waitForTimeout(100);
  }
  check("...and main let the job go at once, not at its deadline", released);

  console.log("\nA refused answer is a refusal, never partial text");
  provide({ text: JSON.stringify({ version: 1, explanations: [{ issueId: "i99", text: "MODEL-TEXT-MUST-NOT-RENDER" }] }) });
  await win.getByTestId("ai-assist-explain").click();
  check("an answer naming a finding that does not exist fails", (await assistSettles(win, "failed")) === "failed");
  check("...saying it was discarded", /discarded/.test(await win.getByTestId("ai-assist-message").innerText()));
  check("...and none of its text reaches the page", !(await win.locator("body").innerText()).includes("MODEL-TEXT-MUST-NOT-RENDER"));

  console.log("\nThe channel refuses what the UI would never send");
  const invalid = await win.evaluate((profile) => window.playwrightFlowStudio.ai.explainValidation({ requestId: "../x", profile }), seededFlow);
  check("a malformed request id is refused in main", !invalid.ok && invalid.code === "INVALID_REQUEST", JSON.stringify(invalid));
  const foreignCancel = await win.evaluate(() => window.playwrightFlowStudio.ai.cancelAssist("never-started"));
  check("cancelling a job this window does not have is NOT_FOUND", foreignCancel.code === "NOT_FOUND", JSON.stringify(foreignCancel));

  console.log("\nL6 — a saved fragment is described on demand, labelled, and nothing changes");
  const summaryBox = win.getByTestId("fragment-ai-summary");
  provide({ text: JSON.stringify({ version: 1, summary: "Fills a field and clicks to continue." }) });
  await win.getByTestId("fragment-insert-open").click();
  await win.getByTestId(`fragment-row-${FRAGMENT_ID}`).click();
  await summaryBox.waitFor({ state: "visible", timeout: 20_000 });
  check("the insert dialog offers a description for the selected fragment", (await stateSettles(win, "fragment-ai-summary", "idle")) === "idle");
  check("...and shows none before it is asked for", (await win.getByTestId("fragment-ai-summary-text").count()) === 0);
  await win.getByTestId("fragment-ai-summarize").click();
  check("describing completes through real IPC", (await stateSettles(win, "fragment-ai-summary", "done")) === "done", await win.getByTestId("fragment-ai-message").innerText().catch(() => ""));
  const summaryText = await win.getByTestId("fragment-ai-summary-text").innerText();
  check("...labelled as an AI interpretation", summaryText.startsWith("AI interpretation") && summaryText.includes("Fills a field and clicks to continue."), summaryText);
  check("describing changed neither the fragment nor the flow on disk", digestOf(fragmentFile) === seededFragmentDigest && fileDigest() === seededDigest);
  provide({ hang: true });
  await win.getByTestId("fragment-ai-summarize").click();
  check("a slow description can be cancelled", (await stateSettles(win, "fragment-ai-summary", "loading")) === "loading");
  await win.getByTestId("fragment-ai-cancel").click();
  check("...and reports it cancelled", (await stateSettles(win, "fragment-ai-summary", "cancelled")) === "cancelled");
  provide({ text: JSON.stringify({ version: 1, summary: "   " }) });
  await win.getByTestId("fragment-ai-summarize").click();
  check("an empty description is refused, not shown", (await stateSettles(win, "fragment-ai-summary", "failed")) === "failed" && (await win.getByTestId("fragment-ai-summary-text").count()) === 0);
  const forgedSummary = await win.evaluate((id) => window.playwrightFlowStudio.ai.summarizeFragment({ requestId: "../x", fragmentId: id }), FRAGMENT_ID);
  check("main refuses a malformed summary request directly", forgedSummary.code === "INVALID_REQUEST", JSON.stringify(forgedSummary));
  await win.getByTestId("fragment-insert-cancel").click();

  console.log("\nAI switched off: the bar says so, validation is untouched");
  aiSettings(false);
  provide({ text: goodAnswer });
  await win.getByTestId("ai-assist-explain").click();
  check("an explain after the switch-off is refused", (await assistSettles(win, "unavailable")) === "unavailable");
  check("...the button is disabled", await win.getByTestId("ai-assist-explain").isDisabled());
  check("...and the bar says validation and fixes work without it", /work without it/.test(await win.getByTestId("ai-assist-message").innerText()));
  const direct = await win.evaluate((profile) => window.playwrightFlowStudio.ai.explainValidation({ requestId: "after-off", profile }), seededFlow);
  check("main refuses it directly too, as DISABLED", direct.code === "DISABLED" && direct.explanations.length === 0, JSON.stringify(direct));
  const findingRows = win.locator(".validation-issue-row");
  check("every finding is still listed", (await findingRows.count()) >= expected.issues.length, String(await findingRows.count()));
  // Select a DIFFERENT step first, so "the finding navigated" cannot pass on a selection that was already there.
  const description = win.locator(".properties-body").getByRole("textbox", { name: "Description" });
  await win.locator(".action-flow-node", { hasText: "Fill name" }).first().click();
  check("(precondition) another step is selected", (await description.inputValue()) !== "Edited after the explanation");
  const clickFinding = expected.issues.find((ref) => ref.issue.nodeId === "click")!.issue.message;
  await findingRows.filter({ hasText: clickFinding }).first().click();
  check("...and a finding still navigates to its step", (await description.inputValue()) === "Edited after the explanation", await description.inputValue());

  console.log("\nL6 with AI off — Describe is disabled, and the no-model similarity hint still works");
  await win.getByTestId("fragment-insert-open").click();
  await win.getByTestId(`fragment-row-${FRAGMENT_ID}`).click();
  check("the fragment description reports local AI unavailable", (await stateSettles(win, "fragment-ai-summary", "unavailable")) === "unavailable");
  check("...with Describe disabled", await win.getByTestId("fragment-ai-summarize").isDisabled());
  await win.getByTestId("fragment-insert-cancel").click();
  await win.getByTestId("fragment-save-open").click();
  const setBox = async (id: string, want: boolean) => {
    const box = win.getByTestId(id);
    if ((await box.isChecked()) !== want) await box.click();
  };
  await setBox("fragment-step-fill", true);
  await setBox("fragment-step-click", false);
  const hint = win.getByTestId("fragment-similar-hint");
  check("(precondition) exactly the fill step is selected", (await win.getByTestId("fragment-step-fill").isChecked()) && !(await win.getByTestId("fragment-step-click").isChecked()));
  check("one matching step of two is not similar enough for a hint", (await hint.count()) === 0);
  await setBox("fragment-step-click", true);
  await hint.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  check("selecting the same shape as a saved fragment shows the hint, with AI off", (await hint.count()) === 1 && (await hint.innerText()).includes(FRAGMENT_NAME), await hint.innerText().catch(() => ""));
  check("...saying it was compared without AI", /without AI/.test(await hint.innerText().catch(() => "")));
  await win.getByTestId("fragment-save-cancel").click();
  check("the fragment on disk is untouched", digestOf(fragmentFile) === seededFragmentDigest);

  console.log("\nAccessibility and theme");
  // Navigating to a finding closes the issue list, as it always has; reopen it.
  if ((await bar(win).count()) === 0) await win.getByTestId("flow-validation-chip").click();
  await bar(win).waitFor({ state: "visible", timeout: 10_000 });
  check("the bar's message is a live status region", (await win.getByTestId("ai-assist-message").getAttribute("role")) === "status");
  aiSettings(true);
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const paint = await bar(win).evaluate((node) => getComputedStyle(node.querySelector(".ai-assist-label")!).color);
  check("the AI label resolves a real colour from tokens in dark theme", paint !== "rgba(0, 0, 0, 0)" && paint !== "", paint);
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  console.log("\nL5b — a failed run shows its evidence and deterministic cause, and AI interprets it on demand");
  const reportDigest = digestOf(reportFile);
  const primaryId = runDiagnostics.cause!.evidenceIds[0];
  provide({
    text: JSON.stringify({
      version: 1,
      insufficient: false,
      category: "server error",
      explanation: "The order submit request failed with a server error before the confirmation could appear.",
      primaryEvidenceIds: [primaryId],
      investigationSteps: ["Check the order service at the time of the run."]
    })
  });
  const seededDetail = await win.evaluate((id) => window.playwrightFlowStudio.telemetry.runDetail(id), RUN_ID);
  check("(precondition) main's durable history holds the seeded failed run", seededDetail.run?.executionId === RUN_EXEC, JSON.stringify(seededDetail.run ?? null).slice(0, 200));
  const failuresView = await win.evaluate(() => window.playwrightFlowStudio.telemetry.failures("24h"));
  check(
    "(precondition) Failure Analytics' own query lists the seeded run",
    failuresView.recent.some((row) => row.instanceId === RUN_ID),
    JSON.stringify({ total: failuresView.total, recent: failuresView.recent.map((row) => row.instanceId) })
  );
  // The designer still holds the unsaved edit made for the stale-answer check, so leaving it must
  // raise the unsaved-changes guard. Discard it: the saved flow must stay exactly as seeded.
  if ((await win.locator("button.nav-item", { hasText: "Failure Analytics" }).count()) === 0) await navClick(win, "Reports");
  await navClick(win, "Failure Analytics");
  const discard = win.getByRole("button", { name: "Discard Changes" });
  await discard.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  check("leaving the designer with an unsaved edit raises the unsaved-changes guard", (await discard.count()) === 1);
  if ((await discard.count()) === 1) await discard.click();
  const openDrawer = async () => {
    // Reports is a collapsible nav group; its pages are only clickable once it is open.
    if ((await win.locator("button.nav-item", { hasText: "Failure Analytics" }).count()) === 0) await navClick(win, "Reports");
    await navClick(win, "Failure Analytics");
    const open = win.getByTestId(`failure-evidence-open-${RUN_ID}`);
    await open.waitFor({ state: "visible", timeout: 15_000 }).catch(async () => {
      const page = await win.evaluate(() => (document.querySelector("main") ?? document.body).innerText.slice(0, 400));
      const nav = await win.locator("button.nav-item").allInnerTexts();
      throw new Error(`no evidence control for ${RUN_ID}; nav=${JSON.stringify(nav)} page=${JSON.stringify(page)}`);
    });
    await open.click();
    const drawer = win.getByRole("dialog", { name: "Run detail" });
    await drawer.waitFor({ state: "visible", timeout: 15_000 });
    await drawer.getByTestId("failure-evidence-section").waitFor({ state: "visible", timeout: 15_000 });
    return drawer;
  };
  let drawer = await openDrawer();
  check("the drawer shows the run's captured failure evidence", (await drawer.getByTestId("failure-evidence-section").getAttribute("data-evidence-state")) === "captured");
  check("...its deterministic cause, as L5a concluded it", (await drawer.getByTestId("failure-cause").getAttribute("data-cause")) === runDiagnostics.cause!.cause, await drawer.getByTestId("failure-cause").innerText());
  check("...and every captured event", (await drawer.getByTestId("failure-evidence-event").count()) === runDiagnostics.evidence.length, String(await drawer.getByTestId("failure-evidence-event").count()));
  const drawerText = await drawer.innerText();
  check("no query secret or row id L5a stripped reaches the drawer", !drawerText.includes("gui-secret-token") && !drawerText.includes("40001"));
  check("AI analysis waits to be asked", (await stateSettles(win, "failure-ai-analysis", "idle")) === "idle" && (await drawer.getByTestId("failure-ai-result").count()) === 0);
  await drawer.getByTestId("failure-ai-analyze").click();
  check("analysis completes through real IPC", (await stateSettles(win, "failure-ai-analysis", "done")) === "done", await drawer.getByTestId("failure-ai-message").innerText().catch(() => ""));
  const resultText = await drawer.getByTestId("failure-ai-result").innerText();
  check("...labelled as an AI interpretation, in its own section", resultText.startsWith("AI interpretation") && resultText.includes("server error"), resultText);
  check("...saying it covers both instances that failed the same way", /covers 2 failed instances/.test(await drawer.getByTestId("failure-ai-message").innerText()));
  check(
    "...and the evidence it cites is marked in the list, so the citation can be checked",
    (await drawer.locator(`[data-testid="failure-evidence-event"][data-evidence-id="${primaryId}"]`).getAttribute("data-ai-cited")) === "primary"
  );
  check("...while the deterministic cause is unchanged", (await drawer.getByTestId("failure-cause").getAttribute("data-cause")) === runDiagnostics.cause!.cause);
  // The report gains ONE thing, the optional diagnostics extension; everything the run wrote stays.
  check("...and says it was saved with the run's report", /Saved with this run's report/.test(await drawer.getByTestId("failure-ai-message").innerText()));
  const afterSave = JSON.parse(readFileSync(reportFile, "utf8")) as ConcurrentRunReport & { id: string };
  const { diagnostics: savedExtension, ...runAsWritten } = afterSave;
  check("the report on disk holds one saved analysis", savedExtension?.analyses?.length === 1 && savedExtension.analyses[0].instanceId === RUN_ID, JSON.stringify(savedExtension).slice(0, 300));
  check("...referencing both instances that failed the same way", JSON.stringify([...(savedExtension?.analyses[0]?.instanceIds ?? [])].sort()) === JSON.stringify([RUN_ID, `${RUN_ID}-row2`].sort()));
  check("...while everything the run wrote, evidence and cause included, is untouched", JSON.stringify(runAsWritten) === JSON.stringify(storedRun));
  const deleteButton = drawer.getByRole("button", { name: "Delete saved analysis" });
  await deleteButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("a saved analysis offers a named Delete control", (await deleteButton.count()) === 1);
  const savedDigest = digestOf(reportFile);
  provide({ text: JSON.stringify({ version: 1, insufficient: false, category: "guess", explanation: "L5B-MODEL-GUESS", primaryEvidenceIds: ["ev-999"] }) });
  await drawer.getByTestId("failure-ai-analyze").click();
  check("an answer citing evidence the run never captured is refused", (await stateSettles(win, "failure-ai-analysis", "failed")) === "failed");
  check("...and none of its text reaches the page", !(await win.locator("body").innerText()).includes("L5B-MODEL-GUESS"));
  check("...nor the report on disk, whose saved analysis is untouched", digestOf(reportFile) === savedDigest);
  const forgedAnalysis = await win.evaluate((id) => window.playwrightFlowStudio.ai.analyzeFailure({ requestId: "ok-id", executionId: "../x", instanceId: id }), RUN_ID);
  check("main refuses a malformed analysis request directly", forgedAnalysis.code === "INVALID_REQUEST", JSON.stringify(forgedAnalysis));
  const forgedDelete = await win.evaluate((id) => window.playwrightFlowStudio.ai.deleteFailureAnalysis({ executionId: "../x", instanceId: id }), RUN_ID);
  check("...and a malformed delete request, deleting nothing", forgedDelete.code === "INVALID_REQUEST" && digestOf(reportFile) === savedDigest, JSON.stringify(forgedDelete));
  await win.keyboard.press("Escape");

  drawer = await openDrawer();
  check("reopening the drawer shows the saved analysis without asking again", (await stateSettles(win, "failure-ai-analysis", "stored")) === "stored");
  check("...its text", /server error/.test(await drawer.getByTestId("failure-ai-result").innerText().catch(() => "")));
  check("...labelled with when it was saved", /^Saved /.test(await drawer.getByTestId("failure-ai-stored").innerText().catch(() => "")));
  check(
    "...and its citation still marked, because it was made for this instance",
    (await drawer.locator(`[data-testid="failure-evidence-event"][data-evidence-id="${primaryId}"]`).getAttribute("data-ai-cited")) === "primary"
  );
  await win.keyboard.press("Escape");

  aiSettings(false);
  drawer = await openDrawer();
  check("with AI off, the analysis control reports local AI unavailable", (await stateSettles(win, "failure-ai-analysis", "unavailable")) === "unavailable");
  check("...and is disabled", await drawer.getByTestId("failure-ai-analyze").isDisabled());
  check("...while the evidence and deterministic cause still show without it", (await drawer.getByTestId("failure-cause").count()) === 1 && (await drawer.getByTestId("failure-evidence-event").count()) === runDiagnostics.evidence.length);
  check("...and so does the saved analysis", (await drawer.getByTestId("failure-ai-result").count()) === 1);
  const offDelete = drawer.getByRole("button", { name: "Delete saved analysis" });
  check("...which can still be deleted with AI off", (await offDelete.count()) === 1 && (await offDelete.isEnabled()));
  await offDelete.focus();
  await win.keyboard.press("Enter");
  await drawer.getByTestId("failure-ai-result").waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  check("deleting removes it from the drawer", (await drawer.getByTestId("failure-ai-result").count()) === 0 && (await offDelete.count()) === 0);
  check("...announces it in the live status region", /deleted/.test(await drawer.getByTestId("failure-ai-message").innerText()));
  check(
    "...keeps keyboard focus inside the AI section rather than dropping it to the page",
    await win.evaluate(() => Boolean(document.activeElement && document.activeElement !== document.body && document.querySelector('[data-testid="failure-ai-analysis"]')?.contains(document.activeElement)))
  );
  check("...and returns the report on disk to what the run wrote, byte for byte", digestOf(reportFile) === reportDigest);
  await win.keyboard.press("Escape");

  check("the saved flow is byte-for-byte what was seeded", fileDigest() === seededDigest);
  const errors = console_.errors ?? [];
  check("no renderer error was logged across the journey", errors.length === 0, JSON.stringify(errors).slice(0, 400));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await app?.close().catch(() => undefined);
  try {
    cleanup();
  } catch {
    /* the profile is a temp dir; a Windows file lock here is not a product failure */
  }
}

console.log(`\nverify:ai-assist-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
