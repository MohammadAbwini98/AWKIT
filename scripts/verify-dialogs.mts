/**
 * Deterministic regression for native JavaScript dialog handling (`awkit-azxy`).
 *
 * Runs real {@link FlowProfile}s through the real {@link PlaywrightRunner} against the offline
 * mock-site `/dialog-lab`, so what is proven here is the product's runtime, not a Playwright script.
 *
 * WHY THIS EXISTS: Playwright AUTO-DISMISSES any dialog that has no listener. Before
 * `dialogExpectation` the runner attached none, so `confirm()` always returned false and `prompt()`
 * always returned null — while the clicking step still reported PASSED. The failure was therefore
 * invisible to everything except an assertion on the page's own text, which is exactly what the
 * "accepted" checks below assert.
 *
 * MUTATION CONTRACT (measured, not asserted): removing the `armDialog` call in
 * `StepExecutor.runStepWithWaits` fails 13 of these 18 checks — [1a], [1c]-[1g], [2a]-[2c], [3a],
 * [3b], [4a] and [5a]. The five that still pass are [1b] (auto-dismissing an alert also unblocks
 * the page, so acknowledgement alone cannot detect the regression), [2d] (an optional expectation
 * is meant to tolerate absence) and the three [6] round-trip checks, which never reach a browser.
 * If a future change drops that failure count, the gate has gone vacuous — fix the gate, not the
 * count.
 *
 * Run with: npx tsx scripts/verify-dialogs.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { DialogExpectation, FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { toFlowStep, fromFlowStep } from "../app/renderer/components/workflow/flowProfileMapping";

const PORT = Number(process.env.MOCK_SITE_PORT ?? 4397);
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/dialog-lab`;

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

function flow(id: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  const ids = nodes.map((n) => n.id);
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }))
  };
}

const click = (id: string, testId: string, dialogExpectation?: DialogExpectation): FlowStep => ({
  id,
  type: "click",
  name: id,
  locator: { strategy: "testId", value: testId },
  ...(dialogExpectation ? { dialogExpectation } : {})
});

const assertText = (id: string, testId: string, expected: string): FlowStep => ({
  id,
  type: "assertText",
  name: id,
  locator: { strategy: "testId", value: testId },
  value: expected,
  config: { assertionType: "text", comparisonOperator: "contains", expectedValue: expected }
});

async function makeContext(flowId: string): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-dialogs-"));
  return {
    executionId: "exec-dialogs",
    instanceId: "inst-1",
    scenarioId: "scen-dialogs",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(dir, "downloads"),
      screenshots: join(dir, "screenshots"),
      logs: join(dir, "logs"),
      reports: join(dir, "reports"),
      sessions: join(dir, "sessions")
    }
  };
}

const instanceConfig = { id: "ic", name: "ic", browser: "chromium", headless: true } as unknown as InstanceConfig;

/** Execute one flow and return its per-step results. */
async function run(profile: FlowProfile): Promise<{ status: string; steps: { stepId: string; status: string; error?: string }[] }> {
  const scenario: ScenarioProfile = {
    id: `sc-${profile.id}`,
    name: profile.id,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId: profile.id, required: true }],
    links: [],
    failurePolicy: { onFlowFailure: "stop", captureScreenshot: false }
  } as unknown as ScenarioProfile;
  const runner = new PlaywrightRunner({ flows: [profile], productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
  const result = await runner.executeScenario(scenario, await makeContext(profile.id), instanceConfig);
  const steps = result.flows.flatMap((f) => (f.steps ?? []).map((s) => ({ stepId: s.stepId, status: s.status, error: s.error ? String(s.error) : undefined })));
  return { status: result.status, steps };
}

const statusOf = (steps: { stepId: string; status: string }[], id: string): string | undefined => steps.find((s) => s.stepId === id)?.status;
const errorOf = (steps: { stepId: string; error?: string }[], id: string): string => steps.find((s) => s.stepId === id)?.error ?? "";

let server: ChildProcess | undefined;

async function startMockSite(): Promise<void> {
  server = spawn(process.execPath, [join(process.cwd(), "mock-site", "server.mjs")], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(LAB);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mock-site did not start on ${BASE}`);
}

async function main(): Promise<void> {
  await startMockSite();

  // ── [1] Every dialog kind, both answers ────────────────────────────────────────────────────
  console.log("\n[1] alert / confirm / prompt, accepted and dismissed");
  const basics = await run(
    flow("dlg-basics", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("alertAccept", "open-alert", { action: "accept", dialogKind: "alert", expectedMessage: "Alert from the dialog lab.", messageMatch: "equals", messageOutputKey: "alertMessage" }),
      assertText("alertAsserted", "dialog-result", "alert acknowledged"),
      click("confirmAccept", "open-confirm", { action: "accept", dialogKind: "confirm" }),
      assertText("confirmAccepted", "dialog-result", "confirm accepted"),
      click("confirmDismiss", "open-confirm", { action: "dismiss", dialogKind: "confirm" }),
      assertText("confirmDismissed", "dialog-result", "confirm dismissed"),
      click("promptAccept", "open-prompt", { action: "accept", dialogKind: "prompt", promptText: "specter-value" }),
      assertText("promptAnswered", "dialog-result", "prompt answered: specter-value"),
      click("promptDismiss", "open-prompt", { action: "dismiss", dialogKind: "prompt" }),
      assertText("promptDismissed", "dialog-result", "prompt dismissed")
    ])
  );
  check("[1a] the whole dialog flow passes", basics.status === "passed", `status=${basics.status} ${basics.steps.map((s) => `${s.stepId}:${s.status}`).join(" ")}`);
  // These four are the mutation-sensitive ones: their text is only reachable via a real accept.
  check("[1b] alert() is acknowledged, so the page script resumed", statusOf(basics.steps, "alertAsserted") === "passed");
  check("[1c] confirm() ACCEPTED returns true to the page", statusOf(basics.steps, "confirmAccepted") === "passed");
  check("[1d] confirm() DISMISSED returns false to the page", statusOf(basics.steps, "confirmDismissed") === "passed");
  check("[1e] prompt() accepted delivers the typed text to the page", statusOf(basics.steps, "promptAnswered") === "passed");
  check("[1f] prompt() dismissed returns null, distinct from an empty accept", statusOf(basics.steps, "promptDismissed") === "passed");

  // An empty accepted prompt must NOT read as a dismissal — "" and null are different answers.
  console.log("\n[1g] empty accept is not a dismissal");
  const emptyPrompt = await run(
    flow("dlg-empty", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("promptEmpty", "open-prompt", { action: "accept", dialogKind: "prompt", promptText: "" }),
      assertText("emptyAccepted", "dialog-result", "prompt answered:")
    ])
  );
  check("[1g] prompt accepted with empty text reports answered, not dismissed", emptyPrompt.status === "passed", `status=${emptyPrompt.status} ${errorOf(emptyPrompt.steps, "emptyAccepted")}`);

  // ── [2] A declared dialog that never appears must FAIL ─────────────────────────────────────
  console.log("\n[2] a declared dialog that never appears is a failure, not a silent pass");
  const absent = await run(
    flow("dlg-absent", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("noDialog", "open-nothing", { action: "accept", dialogKind: "alert", timeoutMs: 1_000 })
    ])
  );
  check("[2a] the flow fails", absent.status !== "passed", `status=${absent.status}`);
  check("[2b] the step itself fails", statusOf(absent.steps, "noDialog") === "failed", `status=${statusOf(absent.steps, "noDialog")}`);
  check("[2c] the error names the missing dialog", /none appeared/i.test(errorOf(absent.steps, "noDialog")), errorOf(absent.steps, "noDialog"));

  // ...unless it was explicitly optional.
  const optional = await run(
    flow("dlg-optional", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("noDialogOptional", "open-nothing", { action: "accept", dialogKind: "alert", timeoutMs: 1_000, required: false }),
      assertText("stillClicked", "nothing-result", "clicked, no dialog")
    ])
  );
  check("[2d] required:false tolerates the absent dialog and still runs the action", optional.status === "passed", `status=${optional.status}`);

  // ── [3] Message assertion ──────────────────────────────────────────────────────────────────
  console.log("\n[3] the dialog's own message is assertable");
  const wrongMessage = await run(
    flow("dlg-msg", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("badMessage", "open-confirm", { action: "accept", dialogKind: "confirm", expectedMessage: "a message this dialog never shows" })
    ])
  );
  check("[3a] a wrong expectedMessage fails the step", statusOf(wrongMessage.steps, "badMessage") === "failed", `status=${statusOf(wrongMessage.steps, "badMessage")}`);
  check("[3b] the error quotes the message actually shown", /Proceed with the dialog lab\?/.test(errorOf(wrongMessage.steps, "badMessage")), errorOf(wrongMessage.steps, "badMessage"));

  // ── [4] Kind filtering: a non-matching expectation does not consume the dialog ──────────────
  console.log("\n[4] an expectation only answers the kind it declared");
  const wrongKind = await run(
    flow("dlg-kind", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("kindMismatch", "open-confirm", { action: "accept", dialogKind: "prompt", timeoutMs: 1_000 })
    ])
  );
  check("[4a] a confirm() does not satisfy a declared prompt expectation", statusOf(wrongKind.steps, "kindMismatch") === "failed", `status=${statusOf(wrongKind.steps, "kindMismatch")}`);

  // ── [5] Two dialogs from one gesture ───────────────────────────────────────────────────────
  console.log("\n[5] one expectation answers one dialog; the second keeps the default");
  const chained = await run(
    flow("dlg-chain", [
      { id: "go", type: "goto", name: "open lab", url: LAB },
      click("chain", "open-chained", { action: "accept", dialogKind: "confirm" }),
      assertText("chainStopped", "chained-result", "chain stopped at prompt")
    ])
  );
  check(
    "[5a] the declared confirm is accepted and the undeclared prompt still auto-dismisses",
    chained.status === "passed",
    `status=${chained.status} ${errorOf(chained.steps, "chainStopped")}`
  );

  // ── [6] Designer round trip ────────────────────────────────────────────────────────────────
  console.log("\n[6] dialogExpectation survives the Flow Designer round trip");
  const original: FlowStep = click("rt", "open-prompt", {
    action: "accept",
    dialogKind: "prompt",
    promptText: "round-trip",
    expectedMessage: "Enter a value:",
    messageMatch: "equals",
    timeoutMs: 4_000,
    messageOutputKey: "msg",
    defaultValueOutputKey: "def"
  });
  const asNode = (step: FlowStep) => ({ id: step.id, type: "flowNode", position: { x: 0, y: 0 }, data: fromFlowStep(step) }) as unknown as Parameters<typeof toFlowStep>[0];
  const roundTripped = toFlowStep(asNode(original), []);
  check("[6a] the expectation survives fromFlowStep → toFlowStep", JSON.stringify(roundTripped.dialogExpectation) === JSON.stringify(original.dialogExpectation), JSON.stringify(roundTripped.dialogExpectation));
  check("[6b] a step with NO expectation does not gain one", toFlowStep(asNode(click("plain", "open-alert")), []).dialogExpectation === undefined);

  // Non-vacuity: the round-trip check would be meaningless if the field were always undefined.
  check("[6c] non-vacuity — the original really carried an expectation", original.dialogExpectation !== undefined && roundTripped.dialogExpectation !== undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.kill();
  });
