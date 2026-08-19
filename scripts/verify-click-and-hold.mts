/**
 * Deterministic regression for the press-and-hold gesture (`awkit-dhdr`).
 *
 * WebDriverUniversity's Actions challenge has a `#click-box` that renders one state on `mousedown`
 * and a different one on `mouseup`. Before this capability the product had no way to express that:
 * `StepType` carried click / dblclick / contextMenu / drag / hover and nothing else, so the Recorder
 * stored a press-and-hold as an ordinary `click` and replay passed through both states in a few
 * milliseconds — neither one ever observable. A normal click approximation, recorded as if it were
 * the gesture the user performed.
 *
 * Drives the REAL recorder init script (installed the way production installs it, via
 * `context.addInitScript`) against `mock-site/drag-lab`, then replays the built step through the
 * production `StepExecutor` on a FRESH page. Capture and replay are both measured; neither is
 * inferred from the other.
 *
 * The load-bearing negative is [C]: a long press on a control that reacts to NOTHING must stay an
 * ordinary click. Duration alone is not evidence of intent, and a recognizer that fired on duration
 * would reclassify every slow click on the page.
 *
 * WHAT REGRESSION MAKES THIS FAIL: dropping the `clickAndHold` step type, recognising a hold without
 * mutation evidence, recognising one below the duration threshold, failing to suppress the trailing
 * click, replaying the hold as `click`, or losing `config.holdMs` through the designer mapping.
 *
 * MUTATION CONTRACT (measured, not asserted). Against 28 checks:
 *   - disable the recognizer (the capability as it stood before) ..... 8 fail, then [D1] stops the run
 *   - recognize a hold on duration alone, with no mutation evidence ... 2 fail ([C1], [C2])
 *   - replay the hold with a zero-length press ....................... 2 fail ([E3] 15ms, [E4])
 * The middle one is small on purpose: only the inert control can see it, which is exactly why the
 * inert control exists. Without it a recognizer that guesses from duration would run all green.
 *
 * Run with: npx tsx scripts/verify-click-and-hold.mts
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { toFlowStep, fromFlowStep } from "../app/renderer/components/workflow/flowProfileMapping";
import { getFlowNodeCatalogItem } from "../app/renderer/components/workflow/flowNodeCatalog";

const PORT = 4424;
const LAB = `http://127.0.0.1:${PORT}/drag-lab`;

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

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-hold-"));
  return {
    executionId: "e",
    instanceId: "i",
    scenarioId: "s",
    flowId: "f",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: join(dir, "d"), screenshots: join(dir, "s"), logs: join(dir, "l"), reports: join(dir, "r"), sessions: join(dir, "se") }
  };
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

let recorderScript: string;

/** Record a fresh session, installing the script the way `RecorderService.wireContext` does. */
async function recordActions(browser: Browser, interact: (page: Page) => Promise<void>): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => {
    actions.push(a as RecordedAction);
  });
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(LAB, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await interact(page);
  await page.waitForTimeout(300);
  await ctx.close();
  return actions;
}

/** A real press-and-hold: press, hold without moving, release. */
async function pressAndHold(page: Page, testId: string, holdMs: number): Promise<void> {
  // Raw mouse coordinates do not auto-scroll the way `locator.click()` does, so an element below
  // the fold would be pressed at a point that is not over it at all.
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`no bounding box for ${testId}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  recorderScript = await getRecorderInitScriptContent();
  const browser = await chromium.launch({ headless: true });

  try {
    // ── [A] capture ───────────────────────────────────────────────────────────────────────────
    console.log("\n[A] the Recorder captures a press-and-hold as its own gesture");
    const held = await recordActions(browser, (p) => pressAndHold(p, "hold-box", 900));
    const holdAction = held.find((a) => a.type === "clickAndHold");
    check("[A1] a clickAndHold action is recorded", !!holdAction, JSON.stringify(held.map((a) => a.type)));
    check(
      "[A2] it is NOT stored as an ordinary click",
      !held.some((a) => a.type === "click"),
      JSON.stringify(held.map((a) => `${a.type}:${a.name}`))
    );
    check("[A3] exactly one action comes out of the one gesture", held.length === 1, String(held.length));
    check(
      "[A4] the locator identifies the pressed element",
      holdAction?.locator?.value === "hold-box" || JSON.stringify(holdAction?.locator ?? {}).includes("hold-box"),
      JSON.stringify(holdAction?.locator)
    );
    const capturedHold = Number((holdAction?.config as { holdMs?: number } | undefined)?.holdMs ?? 0);
    check("[A5] the measured hold duration is carried on the action", capturedHold >= 500, String(capturedHold));
    check("[A6] ...rounded to 100ms rather than reported to the millisecond", capturedHold % 100 === 0, String(capturedHold));
    check("[A7] the action names the gesture in words", /hold/i.test(holdAction?.name ?? ""), holdAction?.name);

    // ── [B] threshold ─────────────────────────────────────────────────────────────────────────
    console.log("\n[B] an ordinary click stays an ordinary click");
    const quick = await recordActions(browser, (p) => p.getByTestId("hold-box").click());
    check("[B1] a normal click records a click", quick.some((a) => a.type === "click"), JSON.stringify(quick.map((a) => a.type)));
    check("[B2] ...and not a clickAndHold", !quick.some((a) => a.type === "clickAndHold"), JSON.stringify(quick.map((a) => a.type)));
    const shortPress = await recordActions(browser, (p) => pressAndHold(p, "hold-box", 150));
    check("[B3] a press below the threshold stays a click", shortPress.some((a) => a.type === "click") && !shortPress.some((a) => a.type === "clickAndHold"), JSON.stringify(shortPress.map((a) => a.type)));

    // ── [C] evidence, not duration — the load-bearing negative ────────────────────────────────
    console.log("\n[C] a long press on an inert control is not a hold");
    const inert = await recordActions(browser, (p) => pressAndHold(p, "inert-box", 900));
    check("[C1] a 900ms press on a control that reacts to nothing records no clickAndHold", !inert.some((a) => a.type === "clickAndHold"), JSON.stringify(inert.map((a) => a.type)));
    check("[C2] ...it stays an ordinary click, so nothing is lost either", inert.some((a) => a.type === "click"), JSON.stringify(inert.map((a) => a.type)));

    // ── [D] the built flow ────────────────────────────────────────────────────────────────────
    console.log("\n[D] the built flow keeps the gesture");
    const flow = buildRecordedFlow("Press and hold", held);
    const builtStep = flow.nodes.find((n) => n.type === "clickAndHold");
    check("[D1] the saved flow carries a clickAndHold step", !!builtStep, JSON.stringify(flow.nodes.map((n) => n.type)));
    check("[D2] holdMs survives the build", (builtStep?.config?.holdMs ?? 0) >= 500, JSON.stringify(builtStep?.config));
    check("[D3] the flow contains no stray click for the same gesture", flow.nodes.filter((n) => n.type === "click").length === 0, JSON.stringify(flow.nodes.map((n) => n.type)));

    // ── [E] replay on a fresh page ────────────────────────────────────────────────────────────
    console.log("\n[E] replay through the production StepExecutor");
    const replayCtx = await browser.newContext();
    const replayPage = await replayCtx.newPage();
    await replayPage.goto(LAB, { waitUntil: "domcontentloaded" });
    await replayPage.getByTestId("hold-reset").click();
    const context = await makeContext();
    const exec = new StepExecutor(replayPage, new LocatorFactory(replayPage), new ValueResolver(context), context, undefined, new MemoryRunnerLogger());
    if (!builtStep) throw new Error("no clickAndHold step was built — [D1] already reported why");
    const replayResult = await exec.execute({ ...builtStep, config: { ...builtStep.config, holdMs: 800 } });
    check("[E1] the recorded step replays green", replayResult.status === "passed", replayResult.error);
    check("[E2] the page ends in its released state", (await replayPage.getByTestId("hold-state").textContent()) === "released", await replayPage.getByTestId("hold-state").textContent());
    const observedMs = Number(await replayPage.getByTestId("hold-observed-ms").textContent());
    check("[E3] the page itself measured the button held down for the configured time", observedMs >= 700, `${observedMs}ms`);
    check("[E4] ...which an ordinary click could never produce", observedMs >= 700 && observedMs < 5_000, `${observedMs}ms`);

    // The comparison that makes [E3] mean something: the same locator, clicked normally.
    await replayPage.getByTestId("hold-reset").click();
    await exec.execute({ id: "plain", type: "click", name: "plain click", locator: (builtStep as FlowStep).locator });
    const clickMs = Number(await replayPage.getByTestId("hold-observed-ms").textContent());
    check("[E5] a plain click on the same element holds for a fraction of that", clickMs < 200, `${clickMs}ms vs ${observedMs}ms`);
    await replayCtx.close();

    // ── [F] designer + persistence round trip ─────────────────────────────────────────────────
    console.log("\n[F] designer and persistence round trip");
    check("[F1] the node catalog labels the gesture in words", /hold/i.test(getFlowNodeCatalogItem("clickAndHold").label), getFlowNodeCatalogItem("clickAndHold").label);
    check("[F2] ...distinctly from a plain Click", getFlowNodeCatalogItem("clickAndHold").label !== getFlowNodeCatalogItem("click").label);
    const asNode = (step: FlowStep) =>
      ({ id: step.id, type: "flowNode", position: { x: 0, y: 0 }, data: fromFlowStep(step) }) as unknown as Parameters<typeof toFlowStep>[0];
    const rt = toFlowStep(asNode({ ...(builtStep as FlowStep), config: { holdMs: 1500 } }), []);
    check("[F3] the step type survives the designer round trip", rt.type === "clickAndHold", rt.type);
    check("[F4] holdMs survives it too", rt.config?.holdMs === 1500, JSON.stringify(rt.config));
    const plainClick: FlowStep = { id: "pc", type: "click", name: "plain", locator: { strategy: "testId", value: "hold-box" } };
    check("[F5] an ordinary click does not gain a holdMs", toFlowStep(asNode(plainClick), []).config?.holdMs === undefined);

    const storeDir = await mkdtemp(join(tmpdir(), "awkit-hold-store-"));
    const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
    const toSave: FlowProfile = { ...flow, id: "hold-roundtrip", nodes: flow.nodes.map((n) => (n.type === "clickAndHold" ? { ...n, config: { ...n.config, holdMs: 1200 } } : n)) };
    await store.create(toSave);
    const reloaded = (await store.get("hold-roundtrip"))?.nodes.find((n) => n.type === "clickAndHold");
    check("[F6] save → reload preserves the gesture and its duration", reloaded?.type === "clickAndHold" && reloaded?.config?.holdMs === 1200, JSON.stringify(reloaded?.config));
    const editedFlow: FlowProfile = { ...toSave, nodes: toSave.nodes.map((n) => (n.type === "clickAndHold" ? { ...n, config: { ...n.config, holdMs: 2000 } } : n)) };
    await store.update("hold-roundtrip", editedFlow);
    const reEdited = (await store.get("hold-roundtrip"))?.nodes.find((n) => n.type === "clickAndHold");
    check("[F7] an edit to the duration re-saves and reloads", reEdited?.config?.holdMs === 2000, JSON.stringify(reEdited?.config));
    check("[F8] ...without losing the locator", !!reEdited?.locator, JSON.stringify(reEdited?.locator ?? null));
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
