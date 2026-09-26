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
 * L3 §1 (Element Spy, "Find stronger locator with AI") runs end to end here too: the real Recorder page
 * opens the Recorder's own Chromium on the Feature Test Lab, an element is inspected by a trusted click,
 * the request crosses the real preload and IPC, and main's §7 loop compiles, guards and proves the
 * scripted plan on that live page before the panel shows it — or refuses, cancels, or withholds it when
 * the page or the inspection it was asked for is gone.
 *
 * L3 U1 (owner decision D2, 2026-09-24) too: a proven proposal is attached to a recorded draft step only
 * after the step is chosen and Attach is clicked; main keeps the step's own locator, refuses a request it
 * never answered, saves its own candidate even when the renderer forges one, and the Flow Designer shows
 * the saved candidate as proven on the page but on no run, with nothing applied.
 *
 * The provider is the DETERMINISTIC one: `AWKIT_TEST_AI_PROVIDER` names a file holding the next
 * scripted answer, read only by a non-packaged build (the `AWKIT_TEST_LICENSE_BYPASS` pattern). It
 * replaces the transport and the model pack; queue, prompt builder and output contract are production.
 * A pass here says nothing about live-model quality or latency (L1.8 still FAILS).
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-assist-gui
 */
import type { ChildProcess } from "node:child_process";
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
import {
  SPY_FRAME,
  SPY_LAB,
  aiBusy,
  aiReleased,
  captureRecorderBrowsers,
  inspectInSpy,
  openSpy,
  persistedState as persistedStateUnder,
  recorderPage,
  startFeatureTestLab,
  until
} from "./lib/recorder-spy-harness.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probe = isolatedLaunchEnv("awkit-ai-assist-gui");
const providerFile = path.join(probe.dataRoot, "test-ai-provider.json");
// The isolated LOCALAPPDATA would also move Playwright's browser cache (%LOCALAPPDATA%\ms-playwright),
// so the dev-mode Recorder is pointed back at the one already installed, as verify:element-spy uses.
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const { env, electronArgs, dataRoot, cleanup } = { ...probe, env: { ...probe.env, AWKIT_TEST_AI_PROVIDER: providerFile, PLAYWRIGHT_BROWSERS_PATH: browsersPath } };
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
  explanations: expected.issues.map((ref) => ({ issueId: ref.id, text: ref.step })),
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

// L3 U1: one recorded step on the Spy lab, restored as the Recorder's draft at start. Its own locator is
// the one that runs; the U1 section attaches a proven AI proposal to it through the real app.
const U1_ACTION_ID = "u1-save-profile";
writeFileSync(
  path.join(appData, "recorder-draft.json"),
  `${JSON.stringify(
    {
      version: 1,
      updatedAt: now,
      actions: [{ id: U1_ACTION_ID, type: "click", name: "Click Save profile", pageAlias: "main", locator: { strategy: "text", value: "Save profile", quality: { strategy: "text", isUnique: true, matchCount: 1, confidence: "medium" } } }]
    },
    null,
    2
  )}\n`,
  "utf8"
);

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
    .filter((ref, index) => {
      const entry = placement[index];
      return !entry || !entry.text.includes(ref.step) || !entry.row.includes(ref.issue.message);
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

// ── L3 §1: the Element Spy on the real Recorder browser (scripts/lib/recorder-spy-harness.mts) ─────
const spyPort = Number(process.env.AWKIT_AI_ASSIST_GUI_PORT ?? 4436);
const spyOrigin = `http://127.0.0.1:${spyPort}`;
const spyPlan = (target: Record<string, unknown>) => JSON.stringify({ version: 1, target, scopes: [] });
const SAVE_PROFILE_PLAN = spyPlan({ strategy: "role", value: "button", name: "Save profile", exact: true });
const spyAi = (win: Page) => win.getByTestId("element-spy-ai");
const persistedState = () => persistedStateUnder(appData);

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let spySite: ChildProcess | undefined;
try {
  spySite = await startFeatureTestLab(root, spyPort);
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
  // L3 §1: the Element Spy proposal is registered, gated and coded through the real bridge. The proposal
  // itself runs on a Recorder browser page, which verify:element-spy drives directly.
  const spyAnswer = await win.evaluate(() => window.playwrightFlowStudio.ai.proposeInspectionLocator({ requestId: "gui-spy-none" }));
  check("the Element Spy proposal answers NOT_FOUND over real IPC when nothing is inspected", spyAnswer.code === "NOT_FOUND" && spyAnswer.proposal === null, JSON.stringify(spyAnswer));

  console.log("\nL3 §1 — Element Spy: a trusted click in the Recorder's own browser, then Find stronger locator with AI");
  console_.setLabel("element spy");
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  const spyState = persistedState();
  const actionsBeforeSpy = JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions()));
  const flowsBeforeSpy = JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.flows.list()));
  await captureRecorderBrowsers(app);
  await win.getByLabel("Target URL").fill(`${spyOrigin}${SPY_LAB}`);
  const spyOpened = await openSpy(win);
  check(
    "Open Element Spy starts an inspect-only session",
    Boolean(spyOpened),
    `${await win.getByTestId("element-spy-status").innerText().catch(() => "")} | ${await win.getByTestId("element-spy-message").innerText().catch(() => "no message")}`
  );
  const opened = await recorderPage(app, { op: "count" });
  check("(precondition) the harness holds the one browser the Recorder launched, on the Feature Test Lab", opened.startsWith("1 browser(s)") && opened.includes(SPY_LAB), opened);

  const save = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  check("a trusted click inspects the element in the real Recorder browser", Boolean(save), JSON.stringify(save?.owner ?? null));
  check("...and the Spy offers Find stronger locator with AI, idle, with nothing proposed yet", (await stateSettles(win, "element-spy-ai", "idle")) === "idle" && (await win.getByTestId("element-spy-ai-result").count()) === 0);
  const spyPrimary = await win.getByTestId("element-spy-primary").innerText();
  const candidatesBefore = JSON.stringify(save?.candidates ?? null);
  check("(precondition) the scripted plan resolves to exactly the inspected element in that page", (await recorderPage(app, { op: "data-spy", path: SPY_LAB, selector: 'internal:role=button[name="Save profile"s]' })) === "1:save-profile");

  console.log("\n  A plan proven on the live page is shown, labelled AI, and applied nowhere");
  provide({ text: SAVE_PROFILE_PLAN });
  await win.getByTestId("element-spy-ai-propose").click();
  const proposed = await stateSettles(win, "element-spy-ai", "done");
  check("the proposal completes through real IPC, the §7 loop and the browser proof", proposed === "done", `${proposed} — ${await win.getByTestId("element-spy-ai-message").innerText().catch(() => "")}`);
  const proposalText = await win.getByTestId("element-spy-ai-proposal").innerText().catch(() => "");
  check("...the displayed locator is the proven one for the inspected element", /button/.test(proposalText) && proposalText.includes("Save profile"), proposalText);
  check("...labelled as an AI suggestion from local AI", /^AI suggestion/.test(await win.getByTestId("element-spy-ai-result").innerText()) && (await spyAi(win).locator(".ai-assist-label").innerText()).includes("Local AI"));
  check("...saying it was proven on this page and nothing was saved or applied", /Proven on this page[\s\S]*Nothing was saved or applied/.test(await win.getByTestId("element-spy-ai-message").innerText()));
  check("...while the Recorder's own primary locator and candidates are unchanged", (await win.getByTestId("element-spy-primary").innerText()) === spyPrimary && JSON.stringify((await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).inspection?.candidates ?? null) === candidatesBefore);
  check("...and nothing on the page was performed", (await recorderPage(app, { op: "text", path: SPY_LAB, selector: '[data-testid="spy-clicks"]' })) === "0");

  // The test id the request offers for this element: what the real 0.8B was shown and did not return.
  console.log("\n  The offered test id, returned as its own strategy, is proven the same way");
  provide({ text: spyPlan({ strategy: "testId", value: "spy-save-profile" }) });
  check("(precondition) the offered test id resolves to exactly the inspected element", (await recorderPage(app, { op: "data-spy", path: SPY_LAB, selector: '[data-testid="spy-save-profile"]' })) === "1:save-profile");
  await win.getByTestId("element-spy-ai-propose").click();
  const testIdProposed = await stateSettles(win, "element-spy-ai", "done");
  const testIdText = await win.getByTestId("element-spy-ai-proposal").innerText().catch(() => "");
  check("a testId plan for the inspected element is proven and shown", testIdProposed === "done" && testIdText === "testId spy-save-profile", `${testIdProposed} — ${testIdText}`);
  check("...applied nowhere: the Recorder's primary locator and candidates are unchanged, nothing performed", (await win.getByTestId("element-spy-primary").innerText()) === spyPrimary && JSON.stringify((await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).inspection?.candidates ?? null) === candidatesBefore && (await recorderPage(app, { op: "text", path: SPY_LAB, selector: '[data-testid="spy-clicks"]' })) === "0");

  console.log("\n  A plan that reaches a different element is refused in the browser");
  provide({ text: spyPlan({ strategy: "testId", value: "spy-submit-order" }) });
  check("(precondition) the scripted plan is a real, unique element of the page — just not the inspected one", (await recorderPage(app, { op: "data-spy", path: SPY_LAB, selector: '[data-testid="spy-submit-order"]' })) === "1:submit-order");
  await win.getByTestId("element-spy-ai-propose").click();
  check("the wrong-element proposal is refused", (await stateSettles(win, "element-spy-ai", "failed")) === "failed");
  check("...saying none could be proven, and no proposal is displayed — not even the earlier one", /could be proven on this page/.test(await win.getByTestId("element-spy-ai-message").innerText()) && (await win.getByTestId("element-spy-ai-result").count()) === 0);
  check("...and the page was only observed", (await recorderPage(app, { op: "text", path: SPY_LAB, selector: '[data-testid="spy-clicks"]' })) === "0");

  console.log("\n  A sensitive element is refused before any model call");
  const approve = await inspectInSpy(app, win, { frame: SPY_FRAME, selector: '[data-testid="spy-frame-approve"]' }, "Approve in frame");
  check("(precondition) an approval control inside the frame is inspected", Boolean(approve), JSON.stringify(approve?.owner ?? null));
  // A model call would hang forever on this provider, so an answer at all proves none was made.
  provide({ hang: true });
  await win.getByTestId("element-spy-ai-propose").click();
  check("the sensitive element is refused at once", (await stateSettles(win, "element-spy-ai", "failed", 10_000)) === "failed");
  check("...saying why", /never proposes locators for sensitive or sign-in elements/.test(await win.getByTestId("element-spy-ai-message").innerText()));
  check("...and main never started a model job", (await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus())).state !== "busy" && (await aiReleased(win)));

  console.log("\n  Cancel ends the job in main, and nothing arrives after it");
  await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  provide({ hang: true });
  await win.getByTestId("element-spy-ai-propose").click();
  check("a pending proposal shows loading with Cancel", (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await win.getByTestId("element-spy-ai-cancel").isEnabled()));
  check("(precondition) main is holding the model job", await aiBusy(win));
  await win.getByTestId("element-spy-ai-cancel").click();
  check("Cancel reports it cancelled", (await stateSettles(win, "element-spy-ai", "failed")) === "failed" && /Cancelled/.test(await win.getByTestId("element-spy-ai-message").innerText()));
  check("...and main let the job go at once", await aiReleased(win));
  const LATE_MS = 3_000;
  provide({ text: SAVE_PROFILE_PLAN, delayMs: LATE_MS });
  const lateStarted = Date.now();
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) a slow proposal is pending", (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await aiBusy(win)));
  await win.getByTestId("element-spy-ai-cancel").click();
  check("cancelling it releases main before its answer was due", (await aiReleased(win)) && Date.now() - lateStarted < LATE_MS);
  await until(async () => Date.now() - lateStarted > LATE_MS + 1_500, LATE_MS + 5_000);
  check("...and its answer never reaches the panel", (await spyAi(win).getAttribute("data-assist-state")) === "failed" && (await win.getByTestId("element-spy-ai-result").count()) === 0);

  console.log("\n  A new inspection abandons the job for the old one");
  provide({ text: SAVE_PROFILE_PLAN, delayMs: LATE_MS });
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) a proposal for Save profile is pending", (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await aiBusy(win)));
  const supersededAt = Date.now();
  const displayName = await inspectInSpy(app, win, { selector: '[data-testid="spy-display-name"]' }, "Display name");
  check("inspecting another element resets the panel for it", Boolean(displayName) && (await stateSettles(win, "element-spy-ai", "idle")) === "idle");
  check("...and the old job is cancelled in main", await aiReleased(win));
  await until(async () => Date.now() - supersededAt > LATE_MS + 1_500, LATE_MS + 5_000);
  check("...so no answer for Save profile is ever painted under Display name", (await spyAi(win).getAttribute("data-assist-state")) === "idle" && (await win.getByTestId("element-spy-ai-result").count()) === 0);

  console.log("\n  The inspected document is replaced while a proposal is pending");
  const reloaded = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  provide({ text: SAVE_PROFILE_PLAN, delayMs: LATE_MS });
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) a proposal for the inspected element is pending", Boolean(reloaded) && (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await aiBusy(win)));
  await recorderPage(app, { op: "goto", path: SPY_LAB, to: `${spyOrigin}${SPY_LAB}?reloaded=1` });
  const afterReload = await until(async () => {
    const state = await spyAi(win).getAttribute("data-assist-state").catch(() => "gone");
    return state === "loading" ? null : state;
  }, LATE_MS + 20_000);
  check(
    "an answer for an element whose document is gone is never shown as proven",
    afterReload !== null && (await win.getByTestId("element-spy-ai-result").count()) === 0,
    `${afterReload} — ${await win.getByTestId("element-spy-ai-message").innerText().catch(() => "")}`
  );
  check("...and main is released", await aiReleased(win));
  provide({ text: SAVE_PROFILE_PLAN });
  await win.getByTestId("element-spy-ai-propose").click();
  check(
    "asking again for the old inspection is refused, not proven on the new document",
    (await stateSettles(win, "element-spy-ai", "failed")) === "failed" && (await win.getByTestId("element-spy-ai-result").count()) === 0,
    await win.getByTestId("element-spy-ai-message").innerText().catch(() => "")
  );
  const fresh = await inspectInSpy(app, win, { selector: '[data-testid="spy-display-name"]' }, "Display name");
  const freshSave = fresh ? await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile") : null;
  await win.getByTestId("element-spy-ai-propose").click();
  check("inspecting it again on the new document proves normally", Boolean(freshSave) && (await stateSettles(win, "element-spy-ai", "done")) === "done");

  console.log("\n  Local AI switched off: the Spy still works and says why AI does not");
  aiSettings(false);
  await win.getByTestId("element-spy-ai-propose").click();
  check("a proposal after the switch-off is refused as unavailable", (await stateSettles(win, "element-spy-ai", "unavailable")) === "unavailable");
  check("...the button is disabled", await win.getByTestId("element-spy-ai-propose").isDisabled());
  check("...and the panel says the Recorder's candidates work without it", /Local AI is turned off\. The candidates above work without it\./.test(await win.getByTestId("element-spy-ai-message").innerText()));
  const offInspection = await inspectInSpy(app, win, { selector: '[data-testid="spy-display-name"]' }, "Display name");
  check("inspecting still works with AI off", Boolean(offInspection) && (await win.getByTestId("element-spy-candidates").count()) === 1);
  const offDirect = await win.evaluate(() => window.playwrightFlowStudio.ai.proposeInspectionLocator({ requestId: "spy-after-off" }));
  check("...and main refuses a direct request as DISABLED", offDirect.code === "DISABLED" && offDirect.proposal === null, JSON.stringify(offDirect));
  aiSettings(true);

  console.log("\n  A protected sign-in page is never inspected, so AI is never offered on it");
  await recorderPage(app, { op: "goto", path: SPY_LAB, to: `${spyOrigin}/mock/protected-login` });
  const refused = await until(async () => (await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).refused === "protected-login", 20_000);
  const refusedShown = await until(async () => /protected login surface was detected/.test(await win.getByTestId("element-spy-status").innerText()), 10_000);
  check("the Spy refuses the protected surface and says so", Boolean(refused) && Boolean(refusedShown), await win.getByTestId("element-spy-status").innerText().catch(() => ""));
  await win.getByTestId("element-spy-ai").waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  check("...so the AI control is gone", (await win.getByTestId("element-spy-ai").count()) === 0);
  const protectedDirect = await win.evaluate(() => window.playwrightFlowStudio.ai.proposeInspectionLocator({ requestId: "spy-protected" }));
  check("...and main answers NOT_FOUND: there is nothing to propose for", protectedDirect.code === "NOT_FOUND" && protectedDirect.proposal === null, JSON.stringify(protectedDirect));
  await recorderPage(app, { op: "goto", path: "/mock/protected-login", to: `${spyOrigin}${SPY_LAB}` });
  await win.getByTestId("element-spy-toggle").click();
  await until(async () => (await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).inspecting, 10_000);

  console.log("\n  Close Spy while a proposal is pending");
  const beforeClose = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  check("(precondition) with AI back on, a new inspection offers the proposal", Boolean(beforeClose) && (await stateSettles(win, "element-spy-ai", "idle")) === "idle" && (await win.getByTestId("element-spy-ai-propose").isEnabled()));
  provide({ hang: true });
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) the proposal is pending in main", (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await aiBusy(win)));
  await win.getByTestId("element-spy-stop").click();
  check("closing the Spy removes the pending proposal from the page", Boolean(await until(async () => (await win.getByTestId("element-spy-ai").count()) === 0)));
  check("...and main let the job go", await aiReleased(win));
  check("...with the session's browser closed", (await recorderPage(app, { op: "count" })).endsWith("open pages: "), await recorderPage(app, { op: "count" }));

  console.log("\n  The Recorder browser page is closed while a proposal is pending");
  const reopened = await openSpy(win);
  check("(precondition) the Spy reopens in a new Recorder browser", Boolean(reopened) && (await recorderPage(app, { op: "count" })).includes(SPY_LAB), `${await recorderPage(app, { op: "count" })} | ${await win.getByTestId("element-spy-message").innerText().catch(() => "")}`);
  const beforePageClose = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  check(
    "(precondition) the reopened Spy inspects the element",
    Boolean(beforePageClose),
    `${JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection()))} clicks=${await recorderPage(app, { op: "text", path: SPY_LAB, selector: '[data-testid="spy-clicks"]' }).catch((error) => String(error))}`
  );
  provide({ hang: true });
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) a proposal is pending on the reopened Spy", Boolean(beforePageClose) && (await stateSettles(win, "element-spy-ai", "loading")) === "loading" && (await aiBusy(win)));
  await recorderPage(app, { op: "close", path: SPY_LAB });
  check("closing the inspected page ends the session and removes the pending proposal", Boolean(await until(async () => (await win.getByTestId("element-spy-ai").count()) === 0)));
  check("...and main let the job go", await aiReleased(win));
  const afterPageClose = await win.evaluate(() => window.playwrightFlowStudio.ai.proposeInspectionLocator({ requestId: "spy-page-closed" }));
  check("...and a request for the closed page is NOT_FOUND", afterPageClose.code === "NOT_FOUND" && afterPageClose.proposal === null, JSON.stringify(afterPageClose));

  check("no flow, fragment, report or Recorder draft on disk changed across the Spy journey", persistedState() === spyState);
  check("...no recorded step changed", JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())) === actionsBeforeSpy);
  check("...and the flow library is as it was", JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.flows.list())) === flowsBeforeSpy);

  console.log("\nL3 U1 — a proven proposal attached to a recorded step as a pending candidate, saved, and seen in the Flow Designer");
  console_.setLabel("recorder u1");
  check("(precondition) the Recorder restored the seeded draft step", (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).some((action) => action.id === U1_ACTION_ID));
  // The message still reads "opened" from the previous session, so the new session's own page is the signal.
  await openSpy(win);
  check(
    "(precondition) the Spy reopens on the Feature Test Lab",
    Boolean(await until(async () => ((await recorderPage(app!, { op: "count" })).includes(SPY_LAB) ? true : null), 60_000)),
    await recorderPage(app, { op: "count" })
  );
  const u1Inspected = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
  provide({ text: SAVE_PROFILE_PLAN });
  await win.getByTestId("element-spy-ai-propose").click();
  check("(precondition) a proven proposal is shown", Boolean(u1Inspected) && (await stateSettles(win, "element-spy-ai", "done")) === "done");
  const attachButton = win.getByTestId("element-spy-ai-attach");
  check(
    "Attach is offered but disabled until a step is chosen, and says it replaces nothing",
    (await attachButton.isDisabled()) && /Choose the recorded step above first[\s\S]*does not replace the step's locator/.test(await win.getByTestId("element-spy-ai-attach-note").innerText())
  );
  await win.getByTestId("element-spy-action").selectOption(U1_ACTION_ID);
  check("...and enabled once the step is chosen", await attachButton.isEnabled());
  await attachButton.click();
  const attachedMessage = await until(async () => {
    const message = await win.getByTestId("element-spy-message").innerText().catch(() => "");
    return /attached|Not attached/.test(message) ? message : null;
  }, 20_000);
  check("the person's attach crosses real IPC and main attaches the proposal", /^AI suggestion attached[\s\S]*still runs on its recorded locator/.test(attachedMessage ?? ""), attachedMessage);
  const u1Draft = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).find((action) => action.id === U1_ACTION_ID);
  check(
    "main's draft holds the candidate beside the unchanged recorded locator",
    u1Draft?.locator?.strategy === "text" && u1Draft.locator.value === "Save profile" && u1Draft.locator.pendingUpgrade?.proof === "capture-proven" && u1Draft.locator.pendingUpgrade.candidate.name === "Save profile",
    JSON.stringify(u1Draft?.locator)
  );
  check("the step list says it is attached and not applied", (await win.locator(".recorder-step-meta", { hasText: "AI suggestion attached, not applied" }).count()) === 1);
  const forgedAttach = await win.evaluate(
    (actionId) => window.playwrightFlowStudio.ai.attachInspectionProposal({ requestId: "never-asked", actionId, pendingUpgrade: { candidate: { strategy: "testId", value: "spy-submit-order" } } } as never),
    U1_ACTION_ID
  );
  check("a request main never answered is refused over real IPC, whatever candidate it carries", forgedAttach.code === "NOT_FOUND" && forgedAttach.actions === null, JSON.stringify(forgedAttach));
  // Saved by a renderer that forges the candidate and adds provenance: main saves its own copy.
  const u1Saved = await win.evaluate(async (actionId) => {
    const copy = JSON.parse(JSON.stringify(await window.playwrightFlowStudio.recorder.getActions()));
    const step = copy.find((action: { id: string }) => action.id === actionId);
    step.locator.pendingUpgrade.candidate = { strategy: "testId", value: "spy-submit-order" };
    step.locator.locatorProvenance = { schemaVersion: 1, source: "ai-semantic-upgrade", tier: "T2", actionId: "forged", proof: "replay-proven" };
    return window.playwrightFlowStudio.recorder.saveFlow("U1 GUI flow", copy);
  }, U1_ACTION_ID);
  const u1Step = (u1Saved as FlowProfile).nodes.find((node) => node.name === "Click Save profile");
  check(
    "the saved step keeps its recorded locator, with main's candidate and not the renderer's",
    u1Step?.locator?.strategy === "text" && u1Step.locator.pendingUpgrade?.candidate.name === "Save profile" && u1Step.locator.pendingUpgrade.candidate.strategy === "role" && u1Step.locator.locatorProvenance === undefined,
    JSON.stringify(u1Step?.locator)
  );
  const u1OnDisk = (JSON.parse(readFileSync(path.join(appData, "flows", `${(u1Saved as FlowProfile).id}.json`), "utf8")) as FlowProfile).nodes.find((node) => node.id === u1Step?.id);
  check("...exactly as written to disk", JSON.stringify(u1OnDisk?.locator?.pendingUpgrade) === JSON.stringify(u1Step?.locator?.pendingUpgrade) && u1OnDisk?.locator?.locatorProvenance === undefined);
  check("...and saving cleared the draft", (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length === 0);
  await win.getByTestId("element-spy-stop").click().catch(() => undefined);

  console_.setLabel("flow designer u1");
  await navClick(win, "Flow Designer");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "U1 GUI flow" }).click();
  await win.locator(".action-flow-node", { hasText: "Click Save profile" }).first().click();
  await win.getByTestId("locator-upgrade-section").waitFor({ state: "visible", timeout: 20_000 });
  await win
    .waitForFunction(() => document.querySelector('[data-testid="locator-upgrade-state"]')?.getAttribute("data-upgrade-state") === "capture-proven", null, { timeout: 20_000 })
    .catch(() => undefined);
  const u1State = win.getByTestId("locator-upgrade-state");
  check(
    "the Flow Designer shows it as proven once on the page, not on any run, and never executed",
    (await u1State.getAttribute("data-upgrade-state")) === "capture-proven" && /not yet on any run[\s\S]*never executed/.test(await u1State.innerText()),
    await u1State.innerText().catch(() => "")
  );
  check("...with no Apply offered until replay proof exists", (await win.getByTestId("apply-locator-upgrade").count()) === 0 || (await win.getByTestId("apply-locator-upgrade").isDisabled()));
  check("...while the saved flow still runs the recorded locator", (await win.evaluate(async (id) => (await window.playwrightFlowStudio.flows.get(id))?.nodes.find((node) => node.name === "Click Save profile")?.locator?.strategy, (u1Saved as FlowProfile).id)) === "text");
  provide({ text: goodAnswer });

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
  // The corrective step is the product's (L4b, 2026-09-23): shown inside each explanation, labelled as
  // the rule's, and the one the product built for that finding, whatever the model wrote.
  const stepTexts = await win.getByTestId("ai-explanation-step").allInnerTexts();
  check(
    "...and shows the rule's own corrective action beside it, labelled apart from the AI's text, one per finding",
    stepTexts.length === ids.length && stepTexts.every((text) => text.startsWith("Corrective action")) && expected!.issues.every((ref) => stepTexts.some((text) => text.includes(ref.step))),
    JSON.stringify(stepTexts)
  );
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

  // The constrained schema refuses an invented cause before the display gate; the validator's
  // finding remains visible even when the entire model response is rejected.
  console.log("\nAn invented cause is refused before display");
  const WITHHELD_TEXT = "The runner stops here because this step fails immediately.";
  provide({ text: JSON.stringify({ version: 1, explanations: expected.issues.map((ref, i) => ({ issueId: ref.id, text: i === 0 ? WITHHELD_TEXT : ref.step })), ranking: expected.fixableIds }) });
  await win.getByTestId("ai-assist-explain").click();
  check("the invented cause makes the whole response fail schema validation", (await assistSettles(win, "failed")) === "failed");
  check("the model's words are nowhere on screen", !(await win.locator("body").innerText()).includes("fails immediately") && (await explanations.count()) === 0);
  check("the validator's original finding remains visible", await win.getByText(expected.issues[0].issue.message, { exact: false }).count() > 0);
  check("the saved flow is untouched", fileDigest() === seededDigest);
  provide({ text: goodAnswer });
  await win.getByTestId("ai-assist-explain").click();
  check("a valid explanation can be requested after the refusal", (await assistSettles(win, "done")) === "done");

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
  // Arriving after 31 s, past the 30 s every feature used to share: Qwen3.5-0.8B's real analyses took
  // 97–160 s on this host, longer when it ran hot, so everything below also proves a slow answer is
  // shown and saved.
  const serverError = JSON.stringify({
    version: 1,
    conclusion: [
      {
        primaryEvidenceIds: [primaryId],
        secondaryEvidenceIds: [],
        category: "server error",
        explanation: "The order submit request failed with a server error before the confirmation could appear.",
        investigationSteps: ["Check the order service at the time of the run."]
      }
    ]
  });
  provide({ text: serverError, delayMs: SLOW_ANSWER_MS });
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
  const analysisStarted = Date.now();
  await drawer.getByTestId("failure-ai-analyze").click();
  const analysisState = await stateSettles(win, "failure-ai-analysis", "done", SLOW_ANSWER_MS + 30_000);
  const analysisMs = Date.now() - analysisStarted;
  check(
    "an analysis that takes longer than 30 s completes through real IPC",
    analysisState === "done" && analysisMs >= SLOW_ANSWER_MS,
    `${analysisState} after ${analysisMs} ms — ${await drawer.getByTestId("failure-ai-message").innerText().catch(() => "")}`
  );
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
  provide({
    text: JSON.stringify({ version: 1, conclusion: [{ primaryEvidenceIds: ["ev-999"], secondaryEvidenceIds: [], category: "guess", explanation: "L5B-MODEL-GUESS", investigationSteps: [] }] })
  });
  await drawer.getByTestId("failure-ai-analyze").click();
  check("an answer citing evidence the run never captured is refused", (await stateSettles(win, "failure-ai-analysis", "failed")) === "failed");
  check("...and none of its text reaches the page", !(await win.locator("body").innerText()).includes("L5B-MODEL-GUESS"));
  check("...nor the report on disk, whose saved analysis is untouched", digestOf(reportFile) === savedDigest);
  const forgedAnalysis = await win.evaluate((id) => window.playwrightFlowStudio.ai.analyzeFailure({ requestId: "ok-id", executionId: "../x", instanceId: id }), RUN_ID);
  check("main refuses a malformed analysis request directly", forgedAnalysis.code === "INVALID_REQUEST", JSON.stringify(forgedAnalysis));
  const forgedDelete = await win.evaluate((id) => window.playwrightFlowStudio.ai.deleteFailureAnalysis({ executionId: "../x", instanceId: id }), RUN_ID);
  check("...and a malformed delete request, deleting nothing", forgedDelete.code === "INVALID_REQUEST" && digestOf(reportFile) === savedDigest, JSON.stringify(forgedDelete));
  // This run's cause rests on direct evidence (an HTTP 500), shown right above the AI section, so "not
  // enough evidence to say why" beside it would be the drawer contradicting itself.
  // Delayed, and seen loading first: the drawer is ALREADY "failed" from the refusal above, so waiting
  // for "failed" alone would pass before this answer ever arrived.
  provide({ text: JSON.stringify({ version: 1, conclusion: [] }), delayMs: 2_000 });
  await drawer.getByTestId("failure-ai-analyze").click();
  const declineAsked = (await stateSettles(win, "failure-ai-analysis", "loading", 5_000)) === "loading";
  check("a decline beside the run's own direct cause is refused", declineAsked && (await stateSettles(win, "failure-ai-analysis", "failed")) === "failed", `asked: ${declineAsked}`);
  check(
    "...never shown as inconclusive: the saved, cited analysis stays on screen",
    (await drawer.locator('[data-testid="failure-ai-result"][data-insufficient="true"]').count()) === 0 &&
      /server error/.test(await drawer.getByTestId("failure-ai-result").innerText().catch(() => ""))
  );
  check("...and the report on disk is untouched", digestOf(reportFile) === savedDigest);
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
  spySite?.kill();
  try {
    cleanup();
  } catch {
    /* the profile is a temp dir; a Windows file lock here is not a product failure */
  }
}

console.log(`\nverify:ai-assist-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
