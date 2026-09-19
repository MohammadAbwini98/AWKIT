/**
 * verify:ai-locator-upgrade-gui — the L3 §6 promotion surface in the REAL Electron app.
 *
 * `verify:ai-locator-upgrade` proves the operation itself in Chromium; this proves the parts that
 * only exist once the app is running: the Flow Designer reporting its open flow and dirty state to
 * main over real IPC, main refusing a promotion while that flow is dirty, the Apply control being
 * offered only when the main process says the promotion is permitted, and the applied upgrade's
 * one-click revert putting the previous locator back ON DISK.
 *
 * The profile is isolated and seeded before launch with a flow whose step carries a pending
 * candidate and a replay tally that already satisfies the policy — the app is never asked to
 * manufacture its own evidence, and the assertions read the flow file rather than the app's opinion
 * of it.
 *
 * What makes it fail: the panel offering Apply while the editor is dirty, main accepting it anyway,
 * the promotion not reaching the saved flow, the designer keeping its stale copy afterwards, revert
 * not restoring the previous locator, or any renderer error along the way.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-locator-upgrade-gui
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type Page } from "playwright";

import { compileLocatorPlan } from "@src/ai/locatorPlan";
import { createPendingUpgrade, mergeReplayProof, pendingUpgradeDigests } from "@src/ai/pendingUpgrade";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";

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
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-l3-upgrade-gui");
const appData = path.join(dataRoot, "SpecterStudio");

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

// ── Seed an isolated profile: AI on, one flow with a proven pending candidate ──────────────────
const FLOW_ID = "l3-upgrade-gui";
const STEP_ID = "step-archive";
const flowFile = path.join(appData, "flows", `${FLOW_ID}.json`);

const baseLocator: StepLocator = {
  strategy: "css",
  value: "#lu-archive-visible",
  resolution: "resolved",
  resolvedBy: "recorder",
  quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "medium" }
};
const baseStep: FlowStep = { id: STEP_ID, type: "click", name: "Archive item", position: { x: 260, y: 140 }, locator: baseLocator };

const plan = { version: 1, target: { strategy: "role", value: "button", name: "Archive", exact: true }, scopes: [] };
const compiled = compileLocatorPlan(plan, baseLocator.context);
if (!compiled.ok) throw new Error(`the seeded plan did not compile: ${compiled.code}`);
const pending = createPendingUpgrade({
  step: baseStep,
  compiled,
  meaningChange: false,
  proof: "capture-proven",
  modelId: "seeded-provider",
  now: new Date("2026-09-20T10:00:00.000Z")
});
if (!pending) throw new Error("the seeded step produced no pending candidate");

const seededStep: FlowStep = { ...baseStep, locator: { ...baseLocator, pendingUpgrade: pending } };
const seededFlow: FlowProfile = {
  id: FLOW_ID,
  name: "L3 upgrade GUI",
  description: "Seeded for verify:ai-locator-upgrade-gui",
  version: 1,
  nodes: [seededStep],
  edges: []
};

const digests = pendingUpgradeDigests(seededStep);
if (!digests) throw new Error("the seeded step produced no digests");
// Any scenario id: a tally is matched by its flow and step, and by the digests above.
const scopeKey = ["seeded-scenario", FLOW_ID, STEP_ID].join(String.fromCharCode(0));
let tally = undefined;
for (const rowKey of ["row-a", "row-b", "row-b"]) {
  tally = mergeReplayProof(tally, { scopeKey, ...digests, outcome: "proven", code: "PROVEN", rowKey, now: new Date() });
}

mkdirSync(path.join(appData, "flows"), { recursive: true });
mkdirSync(path.join(appData, "ai"), { recursive: true });
mkdirSync(path.join(appData, "locator-recovery", "upgrade-proofs"), { recursive: true });
writeFileSync(flowFile, `${JSON.stringify(seededFlow, null, 2)}\n`, "utf8");
writeFileSync(
  path.join(appData, "ai", "ai-settings.json"),
  `${JSON.stringify({ enabled: true, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: {} }, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  path.join(appData, "locator-recovery", "upgrade-proofs", `${createHash("sha256").update(scopeKey).digest("hex")}.json`),
  `${JSON.stringify(tally, null, 2)}\n`,
  "utf8"
);

const savedLocator = (): StepLocator => (JSON.parse(readFileSync(flowFile, "utf8")) as FlowProfile).nodes[0].locator!;

/** Opt-in tracing for when a check fails: AWKIT_L3_GUI_DIAGNOSE=1 prints both sides of each gate. */
const DIAGNOSE = process.env.AWKIT_L3_GUI_DIAGNOSE === "1";

/**
 * Main's own view of the open editor. Deliberately an awaited `evaluate` in a poll rather than a
 * `waitForFunction` predicate: Playwright never awaits a predicate's promise, and a promise is
 * always truthy, so the wait would pass on its first tick without ever reading the answer.
 */
const mainEditorDirty = (win: Page): Promise<boolean> =>
  win.evaluate(async (id) => (await window.playwrightFlowStudio.ai.listUpgrades(id)).editorDirty, FLOW_ID);

async function mainSees(win: Page, dirty: boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await mainEditorDirty(win)) === dirty) return true;
    await win.waitForTimeout(150);
  }
  return false;
}
async function diagnose(win: Page, label: string): Promise<void> {
  if (!DIAGNOSE) return;
  const fromMain = await mainEditorDirty(win);
  const chip = await win.locator(".header-status-chip", { hasText: "Unsaved changes" }).count();
  const panel = await win.getByTestId("locator-upgrade-state").getAttribute("data-upgrade-state");
  const saveState = await win.locator(".editor-command-save-state").first().textContent().catch(() => "(none)");
  const descriptionValue = await win.locator(".properties-body").getByRole("textbox", { name: "Description" }).inputValue().catch(() => "(none)");
  console.log(`    [diagnose ${label}] mainDirty=${fromMain} chip=${chip} panel=${panel} saveState=${saveState} description=${JSON.stringify(descriptionValue)}`);
}

/** Wait for the panel's lifecycle state, then let the assertion report whatever it actually settled on. */
async function upgradeStateSettles(win: Page, expected: string, timeout = 20_000): Promise<void> {
  await win
    .waitForFunction(
      (want) => document.querySelector('[data-testid="locator-upgrade-state"]')?.getAttribute("data-upgrade-state") === want,
      expected,
      { timeout }
    )
    .catch(() => undefined);
}

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  console.log("\nThe seeded flow opens with its pending candidate visible");
  console_.setLabel("flow designer");
  await navClick(win, "Flow Designer");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "L3 upgrade GUI" }).click();

  const section = win.getByTestId("locator-upgrade-section");
  const state = win.getByTestId("locator-upgrade-state");
  const apply = win.getByTestId("apply-locator-upgrade");
  await section.waitFor({ state: "visible", timeout: 20_000 });
  // The designer recaptures its clean baseline a render after a load, so read the settled state.
  await upgradeStateSettles(win, "eligible");
  await diagnose(win, "after load");
  check("the selected step shows its AI locator upgrade", (await section.count()) === 1);
  check("...as verified and ready to apply", (await state.getAttribute("data-upgrade-state")) === "eligible", await state.innerText());
  check("...naming both locators so the change can be reviewed", /#lu-archive-visible/.test(await section.innerText()) && /Archive/.test(await section.innerText()));
  check("Apply is offered", (await apply.count()) === 1 && (await apply.isEnabled()));
  check("the saved flow is untouched by merely looking at it", savedLocator().strategy === "css");

  console.log("\nUnsaved editor changes defer the promotion, in the app and in main");
  // The STEP's description, scoped to the properties panel: the flow-level description field shares
  // its accessible name but is not part of the saveable document, so editing that one dirties nothing.
  const description = win.locator(".properties-body").getByRole("textbox", { name: "Description" });
  await description.fill("Edited but not saved");
  const chip = win.locator(".header-status-chip", { hasText: "Unsaved changes" });
  await chip.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("editing the step marks the editor dirty", (await chip.count()) === 1);
  await upgradeStateSettles(win, "deferred-editor-dirty");
  await diagnose(win, "after fill");
  check("the panel defers the upgrade while the editor is dirty", (await state.getAttribute("data-upgrade-state")) === "deferred-editor-dirty", await state.innerText());
  check("...and Apply is not offered", await apply.isDisabled());
  // The disabled button is not the control. Wait until main has the editor's report — a renderer's
  // dirty state reaches it over IPC, so the honest test is "once main knows", not "instantly" — then
  // call the channel directly, exactly as a renderer that ignored its own disabled button would.
  check("main is told the flow has unsaved changes", await mainSees(win, true));
  const refusedWhileDirty = await win.evaluate(
    ([flowId, stepId, createdAt]) => window.playwrightFlowStudio.ai.promoteUpgrade({ flowId, stepId, createdAt }),
    [FLOW_ID, STEP_ID, pending.createdAt]
  );
  check("...and main refuses the promotion even when the IPC is called directly", refusedWhileDirty.ok === false && refusedWhileDirty.detail === "EDITOR_DIRTY", JSON.stringify(refusedWhileDirty));
  check("...leaving the saved locator alone", savedLocator().strategy === "css" && savedLocator().locatorProvenance === undefined);

  console.log("\nAfter saving, the promotion applies and the designer reloads what was written");
  await win.getByTestId("page-action-save").click();
  await upgradeStateSettles(win, "eligible");
  check("saving the flow makes the upgrade applicable again", (await state.getAttribute("data-upgrade-state")) === "eligible", await state.innerText());
  await apply.click();
  await win.getByTestId("locator-upgrade-applied").waitFor({ state: "visible", timeout: 20_000 });

  const promoted = savedLocator();
  check("the saved flow on disk now holds the proven candidate", promoted.strategy === "role" && promoted.value === "button" && promoted.name === "Archive", JSON.stringify(promoted));
  check("...with the previous locator kept as the revert target", promoted.locatorProvenance?.previous.value === "#lu-archive-visible");
  check("...and the pending candidate cleared", promoted.pendingUpgrade === undefined);
  check("...recorded as a user-approved T1 apply", promoted.locatorProvenance?.tier === "T1" && promoted.locatorProvenance.proof === "replay-proven");
  check("the user's saved description survived the promotion", (JSON.parse(readFileSync(flowFile, "utf8")) as FlowProfile).nodes[0].description === "Edited but not saved");
  const locatorValueField = win.getByRole("textbox", { name: "Value" }).first();
  check("the designer reloaded the promoted flow instead of keeping its stale copy", (await locatorValueField.inputValue()) === "button", await locatorValueField.inputValue());
  check("the editor is clean after the reload, so the next save cannot undo the promotion", (await win.locator(".header-status-chip", { hasText: "Unsaved changes" }).count()) === 0);

  console.log("\nThe applied upgrade reverts in one click");
  const revert = win.getByTestId("revert-locator-upgrade");
  check("revert is offered on the applied upgrade", (await revert.count()) === 1 && (await revert.isEnabled()));
  await revert.click();
  await win.waitForFunction(() => document.querySelector('[data-testid="locator-upgrade-applied"]') === null, null, { timeout: 20_000 }).catch(() => undefined);
  const restored = savedLocator();
  check("the previous locator is back on disk", restored.strategy === "css" && restored.value === "#lu-archive-visible", JSON.stringify(restored));
  check("...and nothing claims an AI change any more", restored.locatorProvenance === undefined);
  check("the audit log records the change and its revert", await win.evaluate(async () => {
    const view = await window.playwrightFlowStudio.ai.listAudit({ limit: 10 });
    return view.records.length === 1 && view.records[0].reverted !== undefined;
  }));

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

console.log(`\nverify:ai-locator-upgrade-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
