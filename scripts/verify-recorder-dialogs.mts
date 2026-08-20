/**
 * Deterministic regression for Recorder dialog capture (`awkit-qlg6`).
 *
 * `awkit-azxy` gave the RUNNER a dialog model. The Recorder never produced one: nothing anywhere
 * listened for `page.on("dialog")`, so Playwright auto-dismissed every dialog the recorded page
 * opened. During capture that silently turned `confirm()` into `false` and `prompt()` into `null` —
 * the user was recording against behaviour the site does not have — and the saved flow carried no
 * `dialogExpectation` at all, so replay hit the same silent dismissal.
 *
 * Drives the REAL `RecorderService.wireContext` (not the bare init script) against
 * `mock-site/dialog-lab`, because dialog handling lives in the service, alongside popup registration
 * and frame-chain capture. The lab reports what the PAGE observed, so "the dialog was answered" can
 * never be confused with "the click happened".
 *
 * WHAT REGRESSION MAKES THIS FAIL: removing the dialog listener, failing to answer the dialog,
 * attributing the expectation to the wrong action, persisting the dialog MESSAGE into the step, or
 * dropping `dialogExpectation` in `buildRecordedFlow`.
 *
 * MUTATION CONTRACT (measured, not asserted). Against 18 checks:
 *   - remove the dialog listener (the defect) ............... 13 fail — including [C1], where the
 *     page itself reports "confirm dismissed" instead of "confirm accepted"
 *   - drop `dialogExpectation` in `buildRecordedFlow` ........ 4 fail ([E1]–[E4])
 *   - persist the observed message into the step ............ 1 fail ([A5])
 *
 * Run with: npx tsx scripts/verify-recorder-dialogs.mts
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4426;
const LAB = `http://127.0.0.1:${PORT}/dialog-lab`;

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

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(LAB)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

async function makeContext(flowId: string): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-rec-dialog-"));
  return {
    executionId: "e",
    instanceId: "i",
    scenarioId: "s",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: join(dir, "d"), screenshots: join(dir, "s"), logs: join(dir, "l"), reports: join(dir, "r"), sessions: join(dir, "se") }
  };
}

/**
 * A recording session through the production wiring. `wireContext` is what `startRecording` calls
 * once it has a browser; driving it directly is the established pattern in this repo's Recorder
 * verifiers (see `verify-recorder-locator`) and keeps popup, dialog and frame handling real.
 */
async function record(browser: Browser, interact: (page: Page) => Promise<void>): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const service = new RecorderService() as unknown as {
    isRecording: boolean;
    captureWaitTime: boolean;
    captureSmartWaits: boolean;
    page: Page;
    lastActionPage: Page;
    actions: RecordedAction[];
    scheduleDraftPersist: () => void;
    wireContext: (c: Awaited<ReturnType<Browser["newContext"]>>) => Promise<void>;
    getActions: () => RecordedAction[];
  };
  service.isRecording = true;
  service.captureWaitTime = false;
  service.captureSmartWaits = false;
  service.page = page;
  service.lastActionPage = page;
  service.actions = [];
  service.scheduleDraftPersist = () => undefined;
  await service.wireContext(ctx);
  await page.goto(LAB, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await interact(page);
  await page.waitForTimeout(400);
  const actions = service.getActions();
  await ctx.close();
  return actions;
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  const browser = await chromium.launch({ headless: true });

  try {
    // ── [A] alert ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[A] a click that opens an alert");
    const alertActions = await record(browser, async (p) => {
      await p.getByTestId("open-alert").click();
    });
    const alertClick = alertActions.find((a) => a.type === "click");
    check("[A1] the click is recorded", !!alertClick, JSON.stringify(alertActions.map((a) => a.type)));
    check("[A2] it carries a dialogExpectation", !!alertClick?.dialogExpectation, JSON.stringify(alertClick?.dialogExpectation));
    check("[A3] the dialog kind is recorded as alert", alertClick?.dialogExpectation?.dialogKind === "alert", JSON.stringify(alertClick?.dialogExpectation));
    check("[A4] the recorded policy is accept", alertClick?.dialogExpectation?.action === "accept", JSON.stringify(alertClick?.dialogExpectation));
    check(
      "[A5] the dialog MESSAGE is not persisted into the step",
      alertClick?.dialogExpectation?.expectedMessage === undefined && !JSON.stringify(alertClick ?? {}).includes("Alert from the dialog lab"),
      JSON.stringify(alertClick?.dialogExpectation)
    );

    // ── [B] confirm and prompt ────────────────────────────────────────────────────────────────
    console.log("\n[B] confirm and prompt");
    const confirmActions = await record(browser, async (p) => {
      await p.getByTestId("open-confirm").click();
    });
    const confirmClick = confirmActions.find((a) => a.type === "click");
    check("[B1] a confirm is recorded as a confirm", confirmClick?.dialogExpectation?.dialogKind === "confirm", JSON.stringify(confirmClick?.dialogExpectation));
    const promptActions = await record(browser, async (p) => {
      await p.getByTestId("open-prompt").click();
    });
    const promptClick = promptActions.find((a) => a.type === "click");
    check("[B2] a prompt is recorded as a prompt", promptClick?.dialogExpectation?.dialogKind === "prompt", JSON.stringify(promptClick?.dialogExpectation));
    check("[B3] the prompt carries an editable answer field", typeof promptClick?.dialogExpectation?.promptText === "string", JSON.stringify(promptClick?.dialogExpectation));
    check("[B4] a non-prompt dialog does not gain a promptText", alertClick?.dialogExpectation?.promptText === undefined && confirmClick?.dialogExpectation?.promptText === undefined);

    // ── [C] the page really was answered, not auto-dismissed ──────────────────────────────────
    console.log("\n[C] the recorded page observed a real answer");
    const ctx = await browser.newContext();
    const observePage = await ctx.newPage();
    const service = new RecorderService() as unknown as Record<string, unknown> & { wireContext: (c: unknown) => Promise<void>; getActions: () => RecordedAction[] };
    Object.assign(service, { isRecording: true, captureWaitTime: false, captureSmartWaits: false, page: observePage, lastActionPage: observePage, actions: [], scheduleDraftPersist: () => undefined });
    await service.wireContext(ctx);
    await observePage.goto(LAB, { waitUntil: "domcontentloaded" });
    await observePage.getByTestId("open-confirm").click();
    await observePage.waitForTimeout(400);
    const confirmOutcome = await observePage.getByTestId("dialog-result").textContent();
    check("[C1] the page reports the confirm as ACCEPTED, not dismissed", confirmOutcome === "confirm accepted", String(confirmOutcome));
    await observePage.getByTestId("open-prompt").click();
    await observePage.waitForTimeout(400);
    const promptOutcome = await observePage.getByTestId("dialog-result").textContent();
    check("[C2] the page reports the prompt as ANSWERED, not dismissed", /prompt answered/.test(String(promptOutcome)), String(promptOutcome));
    await ctx.close();

    // ── [D] attribution ───────────────────────────────────────────────────────────────────────
    console.log("\n[D] the expectation lands on the action that caused it");
    const mixed = await record(browser, async (p) => {
      await p.getByTestId("open-nothing").click();
      await p.waitForTimeout(200);
      await p.getByTestId("open-alert").click();
    });
    const clicks = mixed.filter((a) => a.type === "click");
    check("[D1] both clicks are recorded", clicks.length === 2, JSON.stringify(mixed.map((a) => a.name)));
    check("[D2] the control that opens NO dialog gets no expectation", clicks[0]?.dialogExpectation === undefined, JSON.stringify(clicks[0]?.dialogExpectation));
    check("[D3] the control that opens one does", clicks[1]?.dialogExpectation?.dialogKind === "alert", JSON.stringify(clicks[1]?.dialogExpectation));

    // ── [E] the built flow, and replay against the same page ──────────────────────────────────
    console.log("\n[E] the built flow replays the recorded policy");
    const flow = buildRecordedFlow("Recorded confirm", confirmActions);
    const step = flow.nodes.find((n) => n.type === "click");
    check("[E1] the saved step carries the dialogExpectation", step?.dialogExpectation?.dialogKind === "confirm", JSON.stringify(step?.dialogExpectation));

    const storeDir = await mkdtemp(join(tmpdir(), "awkit-rec-dialog-store-"));
    const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
    const runnable: FlowProfile = {
      ...flow,
      id: "recorded-confirm",
      nodes: [
        { id: "goto", type: "goto", name: "open lab", valueSource: { type: "static", value: LAB }, waitUntil: "domcontentloaded" },
        ...flow.nodes.filter((n) => n.type !== "start" && n.type !== "end"),
        { id: "assert", type: "assertText", name: "the page observed an accepted confirm", locator: { strategy: "testId", value: "dialog-result" }, config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "confirm accepted" } }
      ]
    };
    const ids = ["start", ...runnable.nodes.map((n) => n.id), "end"];
    const withEnds: FlowProfile = {
      ...runnable,
      nodes: [{ id: "start", type: "start", name: "start" }, ...runnable.nodes, { id: "end", type: "end", name: "end" }],
      edges: ids.slice(0, -1).map((source, i) => ({ id: `e${i}`, source, target: ids[i + 1], type: "success" as const }))
    };
    await store.create(withEnds);
    const reloaded = await store.get("recorded-confirm");
    const reloadedStep = reloaded?.nodes.find((n) => n.type === "click");
    check("[E2] save → reload preserves the dialog policy", reloadedStep?.dialogExpectation?.dialogKind === "confirm" && reloadedStep?.dialogExpectation?.action === "accept", JSON.stringify(reloadedStep?.dialogExpectation));

    const scenario = {
      id: "sc-rec-dialog",
      name: "recorded dialog",
      executionMode: "sequential",
      maxParallelFlows: 1,
      flows: [{ order: 1, flowId: "recorded-confirm", required: true }],
      links: [],
      failurePolicy: { onFlowFailure: "stop", captureScreenshot: false }
    } as unknown as ScenarioProfile;
    const runner = new PlaywrightRunner({ flows: [reloaded as FlowProfile], productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
    const result = await runner.executeScenario(scenario, await makeContext("recorded-confirm"), { id: "ic", name: "ic", browser: "chromium", headless: true } as unknown as InstanceConfig);
    const steps = result.flows.flatMap((f) => f.steps ?? []);
    check(
      "[E3] the reloaded recording replays green through the real runner",
      result.status === "passed",
      `${result.status}: ${steps.filter((s) => s.status === "failed").map((s) => `${s.stepId}: ${s.error}`).join(" | ")}`
    );
    check("[E4] ...and the page confirms the dialog was ACCEPTED on replay too", steps.find((s) => s.stepId === "assert")?.status === "passed", JSON.stringify(steps.map((s) => `${s.stepId}:${s.status}`)));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
