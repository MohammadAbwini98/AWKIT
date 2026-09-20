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
// `detail` accepts null so a failing `getAttribute` can report "it was absent" rather than needing
// a `?? undefined` at every call site — the absent case is exactly what a failure wants to say.
function check(label: string, condition: unknown, detail?: string | null): void {
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

// ── A second flow for the L3 §10 status surface ────────────────────────────────────────────────
// Two steps in one flow, so switching BETWEEN steps is exercised as a user does it: one locator
// with no AI proposal at all (the badge must still say what the locator is), and one with a
// candidate no browser proof ever ran for (it must never read as proven).
const STATUS_FLOW_ID = "l3-status-gui";
const PLAIN_STEP_ID = "step-plain";
const UNPROVEN_STEP_ID = "step-unproven";
const statusFlowFile = path.join(appData, "flows", `${STATUS_FLOW_ID}.json`);

const plainStep: FlowStep = {
  id: PLAIN_STEP_ID,
  type: "click",
  name: "Open settings",
  position: { x: 120, y: 120 },
  locator: {
    strategy: "testId",
    value: "open-settings",
    resolution: "resolved",
    resolvedBy: "recorder",
    quality: { strategy: "testId", isUnique: true, matchCount: 1, confidence: "high" }
  }
};

const unprovenBase: FlowStep = {
  id: UNPROVEN_STEP_ID,
  type: "click",
  // Deliberately NOT a destructive name: the step-safety keyword rule makes "Delete row" a sensitive
  // step, which is T3, which is a different §10 case entirely (the forbidden step seeded below).
  name: "Archive row",
  position: { x: 120, y: 280 },
  locator: { strategy: "css", value: "#lu-archive-row", resolution: "resolved", resolvedBy: "recorder", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "medium" } }
};
const unprovenCompiled = compileLocatorPlan({ version: 1, target: { strategy: "role", value: "button", name: "Delete", exact: true }, scopes: [] }, unprovenBase.locator?.context);
if (!unprovenCompiled.ok) throw new Error(`the unproven plan did not compile: ${unprovenCompiled.code}`);
const unprovenPending = createPendingUpgrade({
  step: unprovenBase,
  compiled: unprovenCompiled,
  meaningChange: false,
  // No browser proof ran: §10 must show "pending proof", and its evidence must read as unavailable.
  proof: "unprovable-now",
  modelId: "seeded-provider",
  now: new Date("2026-09-20T10:05:00.000Z")
});
if (!unprovenPending) throw new Error("the unproven step produced no pending candidate");
const unprovenStep: FlowStep = { ...unprovenBase, locator: { ...unprovenBase.locator!, pendingUpgrade: unprovenPending } };

// A step AI must never touch, carrying a candidate anyway — the state a rename produces when a
// proposal already exists. §10 must report it as refused outright, not as "not proven yet".
const FORBIDDEN_STEP_ID = "step-forbidden";
const forbiddenBase: FlowStep = {
  id: FORBIDDEN_STEP_ID,
  type: "click",
  name: "Delete account permanently",
  position: { x: 120, y: 440 },
  safety: { sideEffectLevel: "dangerousMutation", retryable: false },
  locator: { strategy: "css", value: "#lu-delete-account", resolution: "resolved", resolvedBy: "recorder", quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "medium" } }
};
const forbiddenCompiled = compileLocatorPlan({ version: 1, target: { strategy: "role", value: "button", name: "Delete", exact: true }, scopes: [] }, forbiddenBase.locator?.context);
if (!forbiddenCompiled.ok) throw new Error(`the forbidden plan did not compile: ${forbiddenCompiled.code}`);
const forbiddenPending = createPendingUpgrade({
  step: forbiddenBase,
  compiled: forbiddenCompiled,
  meaningChange: false,
  proof: "capture-proven",
  modelId: "seeded-provider",
  now: new Date("2026-09-20T10:06:00.000Z")
});
if (!forbiddenPending) throw new Error("the forbidden step produced no pending candidate");
const forbiddenStep: FlowStep = { ...forbiddenBase, locator: { ...forbiddenBase.locator!, pendingUpgrade: forbiddenPending } };

const statusFlow: FlowProfile = {
  id: STATUS_FLOW_ID,
  name: "L3 status GUI",
  description: "Seeded for the L3 §10 status surface",
  version: 1,
  nodes: [plainStep, unprovenStep, forbiddenStep],
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
writeFileSync(statusFlowFile, `${JSON.stringify(statusFlow, null, 2)}\n`, "utf8");
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

/**
 * Select a step the way a user does — by clicking its node on the canvas — rather than by driving
 * the designer's own selection state, so the properties panel is reached through the real path.
 */
async function selectStep(win: Page, stepName: string): Promise<void> {
  const node = win.locator(".action-flow-node", { hasText: stepName }).first();
  try {
    await node.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    const titles = await win.locator(".action-node-title").allInnerTexts();
    throw new Error(`no canvas node named ${JSON.stringify(stepName)}; the canvas shows ${JSON.stringify(titles)}`);
  }
  await node.click();
  await win.getByTestId("locator-upgrade-section").waitFor({ state: "visible", timeout: 20_000 });
}

/** Wait for the §10 badge, then let the assertion report whatever it actually settled on. */
async function badgeSettles(win: Page, expected: string, timeout = 20_000): Promise<void> {
  await win
    .waitForFunction(
      (want) => document.querySelector('[data-testid="locator-quality-class"]')?.getAttribute("data-locator-badge") === want,
      expected,
      { timeout }
    )
    .catch(() => undefined);
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

  // ── L3 §10: the status vocabulary and evidence-on-demand, in the running app ─────────────────
  console.log("\n§10 — a step with no AI proposal still reports what its locator is");
  console_.setLabel("l3 status surface");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "L3 status GUI" }).click();
  await selectStep(win, "Open settings");
  await section.waitFor({ state: "visible", timeout: 20_000 });
  const badge = win.getByTestId("locator-quality-class");
  await badgeSettles(win, "semantic");
  check("the panel renders for a step with no suggestion at all", (await section.count()) === 1);
  check("...badged Semantic from the locator's own class", (await badge.getAttribute("data-locator-badge")) === "semantic", await badge.getAttribute("data-locator-badge"));
  check("...in the no-upgrade state", (await state.getAttribute("data-upgrade-state")) === "no-upgrade", await state.getAttribute("data-upgrade-state"));
  check("...offering neither Apply nor Revert", (await win.getByTestId("apply-locator-upgrade").count()) === 0 && (await win.getByTestId("revert-locator-upgrade").count()) === 0);
  check("...and not stuck on a loading indicator", (await win.getByTestId("locator-status-loading").count()) === 0);

  console.log("\n§10 — evidence is on demand, collapsed until asked for, and read-only");
  const evidence = win.getByTestId("locator-evidence");
  const evidenceToggle = win.getByTestId("locator-evidence-toggle");
  check("the evidence disclosure starts collapsed", (await evidence.evaluate((node) => (node as HTMLDetailsElement).open)) === false);
  check("...and its toggle is keyboard-focusable", await evidenceToggle.evaluate((node) => {
    (node as HTMLElement).focus();
    return document.activeElement === node;
  }));
  await evidenceToggle.press("Enter");
  check("...opening with the keyboard alone", (await evidence.evaluate((node) => (node as HTMLDetailsElement).open)) === true);
  const auditBefore = await win.evaluate(async () => (await window.playwrightFlowStudio.ai.listAudit({ limit: 50 })).total);
  const plainEvidence = await evidence.innerText();
  check("...listing the locator's class and the reason for it", /Strong semantic/.test(plainEvidence) && /Why/.test(plainEvidence), plainEvidence.slice(0, 200));
  check("...and no proposal rows, because there is no proposal", !/Proposed locator/.test(plainEvidence));
  check("opening the evidence changed nothing on disk", (JSON.parse(readFileSync(statusFlowFile, "utf8")) as FlowProfile).nodes[0].locator?.value === "open-settings");
  check("...and asked the AI for nothing", (await win.evaluate(async () => (await window.playwrightFlowStudio.ai.listAudit({ limit: 50 })).total)) === auditBefore);
  await evidenceToggle.press("Enter");
  check("...and closing again with the keyboard", (await evidence.evaluate((node) => (node as HTMLDetailsElement).open)) === false);

  console.log("\n§10 — a candidate with no browser proof never reads as proven");
  await selectStep(win, "Archive row");
  // Precondition first: if main never reports the candidate, the badge below would be asserting the
  // absence of a proposal rather than the handling of an unproven one.
  const statusView = await win.evaluate((id) => window.playwrightFlowStudio.ai.listUpgrades(id), STATUS_FLOW_ID);
  check(
    "main reports the seeded unproven candidate for this step",
    statusView.pending.some((entry) => entry.stepId === UNPROVEN_STEP_ID && entry.proof === "unprovable-now"),
    JSON.stringify(statusView).slice(0, 500)
  );
  await badgeSettles(win, "pending-proof");
  check("the unproven candidate is badged as pending proof", (await badge.getAttribute("data-locator-badge")) === "pending-proof", await badge.getAttribute("data-locator-badge"));
  check("...in the proposed-unproven state", (await state.getAttribute("data-upgrade-state")) === "proposed-unproven", await state.getAttribute("data-upgrade-state"));
  check("...saying it is never executed", /never executed/i.test(await state.innerText()), await state.innerText());
  // "Not yet proven" keeps a disabled Apply, because the action exists and the sentence says what
  // would make it possible. The disabled button is not the guarantee: main refuses it regardless,
  // which is what the direct IPC call below proves.
  const unprovenApply = win.getByTestId("apply-locator-upgrade");
  check("...with Apply present but disabled", (await unprovenApply.count()) === 1 && (await unprovenApply.isDisabled()));
  const refusedUnproven = await win.evaluate(
    ([flowId, stepId, createdAt]) => window.playwrightFlowStudio.ai.promoteUpgrade({ flowId, stepId, createdAt }),
    [STATUS_FLOW_ID, UNPROVEN_STEP_ID, unprovenPending.createdAt]
  );
  check(
    "...and main refuses it for want of proof even when the IPC is called directly",
    refusedUnproven.ok === false && refusedUnproven.detail === "PROOF_NOT_SATISFIED",
    JSON.stringify(refusedUnproven)
  );
  check(
    "...leaving the unproven candidate unpromoted on disk",
    (JSON.parse(readFileSync(statusFlowFile, "utf8")) as FlowProfile).nodes[1].locator?.locatorProvenance === undefined
  );
  await evidenceToggle.press("Enter");
  const unprovenEvidence = await evidence.innerText();
  check("its match count is reported as unavailable, not as a match", /Match count[\s\S]*not available/i.test(unprovenEvidence), unprovenEvidence.slice(0, 400));
  check("...and so is the identity result", (await evidence.locator('[data-evidence="identity"][data-unavailable="true"]').count()) === 1);
  check("...and nothing claims it reached the same element", !/same element as the saved one/.test(unprovenEvidence));
  check("switching steps replaced the previous step's evidence entirely", !/open-settings/.test(unprovenEvidence) && /#lu-archive-row/.test(unprovenEvidence), unprovenEvidence.slice(0, 300));

  console.log("\n§10 — a step AI must never change is refused outright, however proven");
  await selectStep(win, "Delete account permanently");
  await badgeSettles(win, "rejected");
  check("the sensitive step's candidate is badged as rejected", (await badge.getAttribute("data-locator-badge")) === "rejected", await badge.getAttribute("data-locator-badge"));
  check("...in the forbidden state, not merely unproven", (await state.getAttribute("data-upgrade-state")) === "forbidden", await state.getAttribute("data-upgrade-state"));
  check("...saying AI never changes this kind of step", /never changes the locator of a sensitive action/.test(await state.innerText()), await state.innerText());
  check("...with no Apply control at all, disabled or otherwise", (await win.getByTestId("apply-locator-upgrade").count()) === 0);
  const refusedForbidden = await win.evaluate(
    ([flowId, stepId, createdAt]) => window.playwrightFlowStudio.ai.promoteUpgrade({ flowId, stepId, createdAt }),
    [STATUS_FLOW_ID, FORBIDDEN_STEP_ID, forbiddenPending.createdAt]
  );
  check("...and main refuses it as T3 even when the IPC is called directly", refusedForbidden.ok === false && refusedForbidden.detail === "T3_SENSITIVE_STEP", JSON.stringify(refusedForbidden));
  check("...leaving the sensitive step's locator untouched", (JSON.parse(readFileSync(statusFlowFile, "utf8")) as FlowProfile).nodes[2].locator?.value === "#lu-delete-account");

  console.log("\n§10 — switching flows never shows the previous flow's evidence");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "L3 upgrade GUI" }).click();
  await selectStep(win, "Archive item");
  await badgeSettles(win, "guarded");
  const afterSwitch = await section.innerText();
  check("the first flow's step is back to its own badge", (await badge.getAttribute("data-locator-badge")) === "guarded", await badge.getAttribute("data-locator-badge"));
  check("...with no trace of the other flow's step", !/Delete row|#lu-delete-row|open-settings/.test(afterSwitch), afterSwitch.slice(0, 300));
  check("...and the panel settled rather than loading forever", (await win.getByTestId("locator-status-loading").count()) === 0);

  console.log("\n§10 — the badge is themed, not hardcoded, in light and dark");
  for (const theme of ["light", "dark"] as const) {
    await win.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const paint = await badge.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, border: style.borderTopColor };
    });
    // A tone class that never matched would leave the badge painted exactly like the panel around
    // it: same background, inherited text colour. Asserting they DIFFER is what proves the rule is
    // live rather than dead under a later cascade block.
    const panel = await section.evaluate((node) => getComputedStyle(node).backgroundColor);
    check(`in ${theme}, the badge resolves its own colours from tokens`, paint.background !== panel && paint.background !== "rgba(0, 0, 0, 0)", `${theme}: badge=${paint.background} panel=${panel} text=${paint.color}`);
    check(`...and its text is not transparent in ${theme}`, paint.color !== "rgba(0, 0, 0, 0)" && paint.color !== paint.background, `${theme}: ${paint.color}`);
  }
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  console.log("\n§10 — a missing AI runtime changes the badge's AI line, never the locator");
  // The seeded profile has AI enabled with no model pack, which is exactly the shipped state while
  // L1 is pending. The panel must say so without turning a healthy locator into a fault.
  const aiLine = win.getByTestId("locator-ai-availability");
  const aiState = await win.evaluate(async () => {
    const view = await window.playwrightFlowStudio.ai.getStatus();
    return { enabled: view.enabled, state: view.state, pack: view.modelPack.status };
  });
  check("the app reports no model pack, as L1 is still pending", aiState.pack !== "installed", JSON.stringify(aiState));
  if (aiState.enabled && aiState.state !== "unavailable" && aiState.state !== "error") {
    check("...and the panel shows no availability warning, because the provider is not reporting one", (await aiLine.count()) === 0, JSON.stringify(aiState));
  } else {
    check("...and the panel says so on its own line", (await aiLine.count()) === 1, JSON.stringify(aiState));
    check("...saying recording and running are unaffected", /Recording and\s+running this flow are unaffected/.test(await aiLine.innerText()), await aiLine.innerText());
    check("...while the locator keeps its own badge", (await badge.getAttribute("data-locator-badge")) === "guarded", await badge.getAttribute("data-locator-badge"));
  }

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
