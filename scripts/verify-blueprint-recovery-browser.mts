/**
 * Real-browser Locator Blueprint acceptance gate (awkit-c2z).
 *
 * Run with: npm run verify:blueprint-recovery-browser
 *
 * This is the browser half deliberately absent from verify:blueprint-recovery. It drives the exact
 * Recorder init script to capture a click and its in-page blueprint, assembles the persisted
 * PageBlueprint through buildRecordedFlow, then mutates the Feature Test Lab DOM so every recorded
 * locator misses. LocatorFactory must fall through its capped broad scan and use the stored
 * blueprint neighborhood to click the original target at the production 0.86 similarity threshold.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowStep, LocatorCandidate } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import type { LocatorBlueprintStore, PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { createPageFingerprint, hashFingerprint, similarity } from "@src/runner/locatorFingerprint";

const PORT = 4428;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET_SELECTOR = '[data-test="blueprint-primary"]';
const MUTATED_SELECTOR = ".blueprint-mutated-target";
const RECOVERY_THRESHOLD = 0.86;

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/blueprint-recovery-lab`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock site did not start");
}

async function openRecorderPage(): Promise<{ browser: Browser; context: BrowserContext; page: Page; actions: RecordedAction[] }> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
  await context.exposeBinding("__awtkit_recordSignal", () => undefined);
  const page = await context.newPage();
  await page.goto(`${BASE}/blueprint-recovery-lab`);
  return { browser, context, page, actions };
}

function clickStep(actions: RecordedAction[], blueprints: PageBlueprint[]): FlowStep {
  const flow = buildRecordedFlow("Blueprint browser recovery", actions, blueprints);
  return required(flow.nodes.find((node) => node.type === "click"), "recorded click step");
}

function candidatesOf(step: FlowStep): LocatorCandidate[] {
  const locator = required(step.locator, "step locator");
  return [
    { strategy: locator.strategy, value: locator.value, name: locator.name, exact: locator.exact },
    ...(locator.alternatives ?? [])
  ];
}

async function candidateCounts(factory: LocatorFactory, step: FlowStep): Promise<number[]> {
  return Promise.all(
    candidatesOf(step).map(async (candidate) =>
      (await factory.locateCandidate(candidate, step.locator?.context)).count().catch(() => -1)
    )
  );
}

async function mutate(page: Page, belowThreshold: boolean): Promise<void> {
  await page.evaluate((below) => {
    const api = (window as unknown as { __blueprintLab?: { mutate: (low?: boolean) => void } }).__blueprintLab;
    if (!api) throw new Error("Blueprint lab API unavailable");
    api.mutate(below);
  }, belowThreshold);
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __blueprintLab?: { reset: () => void } }).__blueprintLab;
    if (!api) throw new Error("Blueprint lab API unavailable");
    api.reset();
  });
}

async function fingerprintScore(page: Page, blueprint: PageBlueprint): Promise<number> {
  const element = required(blueprint.elements[0], "element blueprint");
  const raw = await page.locator(MUTATED_SELECTOR).evaluate(createPageFingerprint);
  return similarity(element.fingerprint, hashFingerprint(raw));
}

async function main(): Promise<void> {
  const recoveryRoot = await mkdtemp(join(tmpdir(), "awkit-blueprint-browser-"));
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    await waitForServer();
    const opened = await openRecorderPage();
    browser = opened.browser;
    context = opened.context;
    const { page, actions } = opened;

    console.log("Recorder capture -> blueprint assembly:");
    await page.locator(TARGET_SELECTOR).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="blueprint-result"]')?.textContent === "clicked-original-target");
    const recordedAction = required(actions.find((action) => action.type === "click"), "browser-recorded click action");
    const capture = recordedAction.locator?.blueprintCapture;
    check("real Recorder init script captured the click", !!recordedAction.locator);
    check("browser capture includes an Element Blueprint draft", !!capture);
    check("captured target is beyond the 200-element broad scan cap", (capture?.documentOrder ?? 0) > 200, String(capture?.documentOrder));
    check("capture records a privacy-masked local URL", capture?.url === `${BASE}/blueprint-recovery-lab`, capture?.url);

    const blueprints: PageBlueprint[] = [];
    const step = clickStep([recordedAction], blueprints);
    const blueprint = required(blueprints[0], "assembled page blueprint");
    const elementBlueprint = required(blueprint.elements[0], "assembled element blueprint");
    check("buildRecordedFlow assigns the step a persisted blueprintId", step.locator?.blueprintId === elementBlueprint.blueprintId);
    check("assembled blueprint preserves browser document order", elementBlueprint.documentOrder === capture?.documentOrder);
    check("recorded primary locator is the unique data-test selector", step.locator?.strategy === "css" && step.locator.value.includes("data-test"), JSON.stringify(step.locator));

    const recoveryStore = new FileLocatorRecoveryStore(recoveryRoot);
    const scope = { scenarioId: "blueprint-browser-scenario", flowId: "blueprint-browser-flow" };
    const seedFactory = new LocatorFactory(page, { recoveryStore, scope, recoveryGraceMs: 0 });
    const seeded = await seedFactory.resolve(step);
    check("original recorded locator resolves before drift", (await seeded.count()) === 1);

    console.log("Above-threshold inserted-sibling recovery:");
    await mutate(page, false);
    const driftFactory = new LocatorFactory(page, { recoveryStore, scope, recoveryGraceMs: 0 });
    const counts = await candidateCounts(driftFactory, step);
    check("DOM mutation retires every recorded locator candidate", counts.every((count) => count === 0), JSON.stringify(counts));
    const shiftedOrder = await page.locator(MUTATED_SELECTOR).evaluate((node) => Array.from(document.body.querySelectorAll("*")).indexOf(node));
    check("fixture inserted exactly one node before the recorded target", shiftedOrder === elementBlueprint.documentOrder + 1, `${elementBlueprint.documentOrder} -> ${shiftedOrder}`);

    const score = await fingerprintScore(page, blueprint);
    check("browser-captured fingerprint remains just above the 0.86 recovery threshold", score >= RECOVERY_THRESHOLD && score < 0.87, score.toFixed(6));
    const unresolvedWithoutBlueprint = await driftFactory.resolve(step);
    check("without blueprint storage the stale step remains unresolved", (await unresolvedWithoutBlueprint.count()) === 0);
    check("without blueprint storage no target or decoy is clicked", (await page.getByTestId("blueprint-result").textContent()) === "idle");

    let blueprintReads = 0;
    const blueprintStore: LocatorBlueprintStore = {
      get: async (pageKey) => {
        blueprintReads += 1;
        return pageKey === blueprint.pageKey ? blueprint : undefined;
      },
      put: async () => undefined,
      list: async () => [blueprint]
    };
    const events: LocatorRecoveryEvent[] = [];
    const recovered = await new LocatorFactory(page, {
      recoveryStore,
      blueprintStore,
      scope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => events.push(event)
    }).resolve(step);
    await recovered.click();
    check("LocatorFactory reads the matching blueprint once after broad recovery misses", blueprintReads === 1, String(blueprintReads));
    check("blueprint-guided recovery clicks the moved target, never the decoy", (await page.getByTestId("blueprint-result").textContent()) === "clicked-mutated-target");
    check("successful blueprint recovery emits the local-recovery event", events.some((event) => event.type === "local-recovery" && (event.score ?? 0) >= RECOVERY_THRESHOLD), JSON.stringify(events));

    console.log("Sensitive-action recovery refusal:");
    await reset(page);
    const sensitiveStep: FlowStep = {
      ...structuredClone(step),
      id: "sensitive-blueprint-step",
      name: "Commit external payment",
      safety: { sideEffectLevel: "externalCommit", retryable: false }
    };
    const sensitiveScope = { scenarioId: "blueprint-sensitive-scenario", flowId: "blueprint-sensitive-flow" };
    const sensitiveSeed = await new LocatorFactory(page, { recoveryStore, scope: sensitiveScope, recoveryGraceMs: 0 }).resolve(sensitiveStep);
    check("sensitive step seeds only from its unchanged recorded locator", (await sensitiveSeed.count()) === 1);
    await mutate(page, false);
    let sensitiveBlueprintReads = 0;
    const sensitiveEvents: LocatorRecoveryEvent[] = [];
    const sensitiveRefused = await new LocatorFactory(page, {
      recoveryStore,
      blueprintStore: {
        ...blueprintStore,
        get: async (pageKey) => {
          sensitiveBlueprintReads += 1;
          return pageKey === blueprint.pageKey ? blueprint : undefined;
        }
      },
      scope: sensitiveScope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => sensitiveEvents.push(event)
    }).resolve(sensitiveStep);
    const sensitiveCount = await sensitiveRefused.count();
    if (sensitiveCount > 0) await sensitiveRefused.click();
    check("sensitive action refuses local and blueprint recovery", sensitiveCount === 0, String(sensitiveCount));
    check("sensitive refusal occurs before blueprint storage is read", sensitiveBlueprintReads === 0, String(sensitiveBlueprintReads));
    check("sensitive refusal performs no click or recovery event", (await page.getByTestId("blueprint-result").textContent()) === "idle" && !sensitiveEvents.some((event) => event.type === "local-recovery"), JSON.stringify(sensitiveEvents));

    console.log("Below-threshold negative control:");
    await reset(page);
    await new LocatorFactory(page, { recoveryStore, scope, recoveryGraceMs: 0 }).resolve(step);
    await mutate(page, true);
    const belowScore = await fingerprintScore(page, blueprint);
    check("negative-control fingerprint falls below 0.86", belowScore < RECOVERY_THRESHOLD, belowScore.toFixed(6));
    const negativeEvents: LocatorRecoveryEvent[] = [];
    const refused = await new LocatorFactory(page, {
      recoveryStore,
      blueprintStore,
      scope,
      recoveryGraceMs: 0,
      onRecoveryEvent: (event) => negativeEvents.push(event)
    }).resolve(step);
    check("below-threshold blueprint candidate is refused", (await refused.count()) === 0);
    check("below-threshold refusal performs no click side effect", (await page.getByTestId("blueprint-result").textContent()) === "idle");
    check("below-threshold refusal emits no recovery success", !negativeEvents.some((event) => event.type === "local-recovery"), JSON.stringify(negativeEvents));
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    server.kill();
    await rm(recoveryRoot, { recursive: true, force: true });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
