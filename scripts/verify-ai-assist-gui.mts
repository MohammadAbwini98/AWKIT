/**
 * verify:ai-assist-gui — the L4b authoring assist in the REAL Electron app.
 *
 * `verify:ai-authoring` proves the contract and the main-process adapter in Node; this proves the
 * parts that only exist once the app runs: the Flow Designer sending its open flow over real IPC, main
 * re-validating it and answering through the production `AiService`, the answer rendered labelled
 * under the finding it belongs to, a stale answer withheld after an edit, cancellation reaching main,
 * a refused answer shown as a refusal, AI switched off leaving validation intact, and the saved flow
 * never touched by any of it.
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
import type { FlowProfile } from "@src/profiles/FlowProfile";
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

const fileDigest = () => createHash("sha256").update(readFileSync(flowFile)).digest("hex");
const seededDigest = fileDigest();

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
  const placement = await win.evaluate(() =>
    [...document.querySelectorAll('[data-testid="ai-explanation"]')].map((node) => {
      let row = node.previousElementSibling;
      while (row && !row.classList.contains("validation-issue-row")) row = row.previousElementSibling;
      return { text: node.textContent ?? "", row: row?.textContent ?? "" };
    })
  );
  const misplaced = expected.issues.filter((ref) => {
    const entry = placement.find((p) => p.text.includes(`EXPL-${ref.id}:`));
    return !entry || !entry.row.includes(ref.issue.message);
  });
  check("...and sits under the row of the validator issue it names", misplaced.length === 0, JSON.stringify(misplaced.map((m) => m.id)));
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
  check("...and main let the job go well before its 30 s timeout", released);

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
