/**
 * verify:flow-fragments-gui — the L6 fragment surfaces in the REAL Electron app.
 *
 * `verify:flow-fragments` proves the contract, the audit matrix and both operations as pure
 * functions. It cannot prove that a user can reach any of it. This proves the parts that only exist
 * once the app is running: the two toolbar controls, capture over real permission-gated IPC landing
 * a real file on disk, the dirty-editor refusal, the library and its audit preview, insertion as an
 * EDITOR transaction (so undo/redo and Save are the existing ones), two insertions of one fragment
 * not colliding, and locator/data-binding metadata surviving insert → save → reload on disk.
 *
 * Assertions read the FILESYSTEM and the canvas, never the app's opinion of either. The profile is
 * isolated and seeded before launch, and every seeded fixture is audited at seed time — a fixture
 * that silently stopped being the thing it is named for would void whole sections while still
 * reporting green.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:flow-fragments-gui
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type Page } from "playwright";

import { auditFragment, isFragmentBlocked, type FlowFragment } from "@src/fragments/FlowFragment";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";

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
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-l6-fragments-gui");
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

/* ── Seed ──────────────────────────────────────────────────────────────────────────────────────
 * One source flow to capture from, one destination to insert into, one flow whose only real step is
 * a protected-login surface, and two stored fragments: a clean one and one that would expand into
 * the destination.
 */
const SOURCE_FLOW_ID = "l6-source";
const DEST_FLOW_ID = "l6-dest";
const PROTECTED_FLOW_ID = "l6-protected";

const step = (over: Partial<FlowStep> & Pick<FlowStep, "id" | "type" | "name">): FlowStep => ({
  position: { x: 280, y: 140 },
  ...over
});

/** Carries BOTH a resilient locator and a runtime-input binding, so metadata loss is detectable. */
const fillStep: FlowStep = step({
  id: "src-fill",
  type: "fill",
  name: "Fill username",
  locator: {
    strategy: "role",
    value: "textbox",
    name: "Username",
    exact: true,
    resolution: "resolved",
    resolvedBy: "recorder",
    quality: { strategy: "role", isUnique: true, matchCount: 1, confidence: "high" }
  },
  valueSource: { type: "runtimeInput", key: "username" },
  onFailure: { action: "stop", screenshot: true }
});

const clickStep: FlowStep = step({
  id: "src-click",
  type: "click",
  name: "Submit",
  locator: { strategy: "css", value: "#submit", resolution: "resolved", resolvedBy: "recorder" }
});

const sourceFlow: FlowProfile = {
  id: SOURCE_FLOW_ID,
  name: "L6 source",
  description: "Seeded for verify:flow-fragments-gui",
  version: 1,
  nodes: [
    step({ id: "start", type: "start", name: "Start" }),
    fillStep,
    clickStep,
    step({ id: "end", type: "end", name: "End" })
  ],
  edges: [
    { id: "e-start", source: "start", target: "src-fill", type: "success" },
    { id: "e-mid", source: "src-fill", target: "src-click", type: "success" },
    { id: "e-end", source: "src-click", target: "end", type: "success" }
  ]
};

const destFlow: FlowProfile = {
  id: DEST_FLOW_ID,
  name: "L6 destination",
  description: "Seeded for verify:flow-fragments-gui",
  version: 1,
  nodes: [step({ id: "start", type: "start", name: "Start" }), step({ id: "end", type: "end", name: "End" })],
  edges: [{ id: "d-edge", source: "start", target: "end", type: "success" }]
};

const protectedFlow: FlowProfile = {
  id: PROTECTED_FLOW_ID,
  name: "L6 protected",
  description: "Seeded for verify:flow-fragments-gui",
  version: 1,
  nodes: [
    step({ id: "start", type: "start", name: "Start" }),
    step({ id: "prot-login", type: "protectedLoginHandoff", name: "Hand off to Chrome" }),
    step({ id: "end", type: "end", name: "End" })
  ],
  edges: []
};

/** The clean stored fragment. Same two steps, so metadata survival is checkable field by field. */
const cleanFragment: FlowFragment = {
  id: "seeded-pair",
  name: "Seeded sign-in pair",
  description: "Two steps with a locator and a runtime input",
  kind: "fragment",
  version: 1,
  nodes: [fillStep, clickStep],
  edges: [{ id: "frag-edge", source: "src-fill", target: "src-click", type: "success" }],
  inputs: [{ key: "username", label: "username", type: "text", required: true }]
};

/** Would expand into the destination it is offered for — blocking, but only at apply time. */
const recursiveFragment: FlowFragment = {
  id: "seeded-recursive",
  name: "Seeded recursive",
  kind: "fragment",
  version: 1,
  nodes: [step({ id: "frag-run", type: "runFlow", name: "Run destination", flowId: DEST_FLOW_ID })],
  edges: [],
  inputs: []
};

// A seeded fixture that is not what it claims voids the section that depends on it, silently.
if (isFragmentBlocked(auditFragment(cleanFragment))) {
  throw new Error("the seeded clean fragment does not audit clean; the insert section would be meaningless");
}
if (isFragmentBlocked(auditFragment(recursiveFragment))) {
  throw new Error("the seeded recursive fragment must be clean UNTIL a destination is supplied");
}
if (!isFragmentBlocked(auditFragment(recursiveFragment, { destinationFlowId: DEST_FLOW_ID }))) {
  throw new Error("the seeded recursive fragment is not recursive against the destination it names");
}

mkdirSync(path.join(appData, "flows"), { recursive: true });
mkdirSync(path.join(appData, "fragments"), { recursive: true });
for (const flow of [sourceFlow, destFlow, protectedFlow]) {
  writeFileSync(path.join(appData, "flows", `${flow.id}.json`), JSON.stringify(flow, null, 2), "utf8");
}
for (const fragment of [cleanFragment, recursiveFragment]) {
  writeFileSync(path.join(appData, "fragments", `${fragment.id}.json`), JSON.stringify(fragment, null, 2), "utf8");
}

const fragmentsOnDisk = (): string[] =>
  readdirSync(path.join(appData, "fragments")).filter((name) => name.endsWith(".json"));
const readFragment = (id: string): FlowFragment =>
  JSON.parse(readFileSync(path.join(appData, "fragments", `${id}.json`), "utf8")) as FlowFragment;
const readFlow = (id: string): FlowProfile =>
  JSON.parse(readFileSync(path.join(appData, "flows", `${id}.json`), "utf8")) as FlowProfile;

/** Canvas node ids, excluding cards that are mid exit-animation. */
const canvasNodeIds = (win: Page): Promise<string[]> =>
  win.evaluate(() =>
    [...document.querySelectorAll(".awkit-flow-node:not(.is-exiting)")]
      .map((node) => node.getAttribute("data-id") ?? "")
      .filter(Boolean)
  );

const openFlow = async (win: Page, name: string): Promise<void> => {
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name }).click();
  await win.waitForTimeout(400);
};

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  console_.setLabel("flow designer");
  await navClick(win, "Flow Designer");

  console.log("\n1. The two fragment controls exist and are reachable");
  const saveOpen = win.getByTestId("fragment-save-open");
  const insertOpen = win.getByTestId("fragment-insert-open");
  await saveOpen.waitFor({ state: "visible", timeout: 15000 });
  check("the Save-as-fragment control is present", await saveOpen.count() === 1);
  check("the Insert-fragment control is present", await insertOpen.count() === 1);
  check("Save as fragment is enabled for a Super User", await saveOpen.isEnabled());
  check("Insert fragment is enabled for a Super User", await insertOpen.isEnabled());

  console.log("\n2. Save as fragment — the dialog, its selection, and the modal focus contract");
  await openFlow(win, "L6 source");
  await saveOpen.click();
  const saveDialog = win.getByTestId("fragment-save-dialog");
  await saveDialog.waitFor({ state: "visible", timeout: 10000 });
  check("the save dialog is a modal dialog", (await saveDialog.getAttribute("aria-modal")) === "true");
  check(
    "focus moved INTO the dialog on open",
    await win.evaluate(() => {
      const dialog = document.querySelector('[data-testid="fragment-save-dialog"]');
      return dialog !== null && dialog.contains(document.activeElement);
    })
  );
  const offered = await win.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="fragment-step-"]')].map((input) =>
      (input.getAttribute("data-testid") ?? "").replace("fragment-step-", "")
    )
  );
  check("only non-terminal steps are offered", offered.length === 2, `offered ${JSON.stringify(offered)}`);
  check("the flow's start step is not offered", !offered.includes("start"));
  check("the flow's end step is not offered", !offered.includes("end"));

  console.log("\n3. Capture writes a real fragment through permission-gated IPC");
  await win.getByTestId("fragment-step-src-fill").check();
  await win.getByTestId("fragment-step-src-click").check();
  await win.getByTestId("fragment-save-name").fill("Captured sign-in");
  await win.getByTestId("fragment-save-description").fill("From the GUI verifier");
  const before = fragmentsOnDisk().length;
  await win.getByTestId("fragment-save-confirm").click();
  await win.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="fragment-save-dialog"]').length === 0 && count > 0,
    before,
    { timeout: 10000 }
  );
  const after = fragmentsOnDisk();
  check("exactly one new fragment file exists on disk", after.length === before + 1, `${before} → ${after.length}`);
  const capturedId = after.map((name) => name.replace(/\.json$/, "")).find((id) => id.startsWith("captured-sign-in-"));
  check("the captured fragment was named from the user's title", capturedId !== undefined, JSON.stringify(after));
  if (capturedId !== undefined) {
    const captured = readFragment(capturedId);
    check("the captured fragment holds exactly the two selected steps", captured.nodes.length === 2);
    check("the internal connector was captured", captured.edges.length === 1);
    check("the captured fragment audits clean", !isFragmentBlocked(auditFragment(captured)));
    check(
      "the bound runtime input was derived into the declaration",
      captured.inputs.some((input) => input.key === "username"),
      JSON.stringify(captured.inputs)
    );
    check(
      "locator metadata survived capture",
      captured.nodes.find((node) => node.id === "src-fill")?.locator?.name === "Username"
    );
    check(
      "the source flow was NOT modified by capture",
      readFlow(SOURCE_FLOW_ID).nodes.length === sourceFlow.nodes.length
    );
  }

  console.log("\n4. A dirty editor refuses capture rather than capturing a stale graph");
  await win.locator(".editor-identity-name input").fill("L6 source edited");
  await win.waitForTimeout(300);
  await saveOpen.click();
  await saveDialog.waitFor({ state: "visible", timeout: 10000 });
  const dirtyNote = win.getByTestId("fragment-save-dirty");
  check("the dialog says the flow must be saved first", await dirtyNote.count() === 1);
  check("Save fragment is disabled while the editor is dirty", await win.getByTestId("fragment-save-confirm").isDisabled());
  await win.keyboard.press("Escape");
  await saveDialog.waitFor({ state: "detached", timeout: 10000 });
  check("Escape closed the dialog", await saveDialog.count() === 0);
  check(
    "focus returned to the control that opened it",
    await win.evaluate(() => document.activeElement?.getAttribute("data-testid") === "fragment-save-open")
  );

  console.log("\n5. Insert — the library, the audit preview, and a refusal that offers no Insert");
  await openFlow(win, "L6 destination"); // discards the unsaved rename; the file is the authority
  await insertOpen.click();
  const insertDialog = win.getByTestId("fragment-insert-dialog");
  await insertDialog.waitFor({ state: "visible", timeout: 10000 });
  await win.getByTestId("fragment-library").waitFor({ state: "visible", timeout: 10000 });
  const rows = await win.evaluate(() => document.querySelectorAll('[data-testid^="fragment-row-"]').length);
  check("the library lists every stored fragment", rows === after.length, `${rows} rows vs ${after.length} files`);

  await win.getByTestId("fragment-row-seeded-recursive").click();
  await win.waitForFunction(
    () => document.querySelectorAll('[data-testid="fragment-findings"] [data-severity="blocking"]').length > 0,
    undefined,
    { timeout: 10000 }
  );
  check(
    "a fragment that would expand into this flow reports a blocking finding",
    await win.evaluate(
      () =>
        document.querySelector('[data-testid="fragment-findings"] [data-severity="blocking"]')?.getAttribute("data-code") ===
        "recursiveFlowReference"
    )
  );
  check("Insert is disabled for a blocked fragment", await win.getByTestId("fragment-insert-confirm").isDisabled());

  await win.getByTestId("fragment-row-seeded-pair").click();
  await win.waitForFunction(
    () => document.querySelectorAll('[data-testid="fragment-detail"]').length > 0,
    undefined,
    { timeout: 10000 }
  );
  await win.waitForFunction(
    () => document.querySelectorAll('[data-testid="fragment-audit-pending"]').length === 0,
    undefined,
    { timeout: 10000 }
  );
  check(
    "switching to a clean fragment clears the previous fragment's blocking finding",
    await win.evaluate(
      () => document.querySelectorAll('[data-testid="fragment-findings"] [data-severity="blocking"]').length === 0
    )
  );
  check(
    "the fragment's required runtime inputs are shown",
    await win.getByTestId("fragment-required-inputs").count() === 1
  );
  check("Insert is enabled for a clean fragment", await win.getByTestId("fragment-insert-confirm").isEnabled());

  console.log("\n6. Insertion is an editor transaction: canvas, identities, undo and redo");
  const baseIds = await canvasNodeIds(win);
  await win.getByTestId("fragment-insert-confirm").click();
  await insertDialog.waitFor({ state: "detached", timeout: 10000 });
  await win.waitForFunction(
    (count) => document.querySelectorAll(".awkit-flow-node:not(.is-exiting)").length === count + 2,
    baseIds.length,
    { timeout: 10000 }
  );
  const afterFirst = await canvasNodeIds(win);
  check("two steps appeared on the canvas", afterFirst.length === baseIds.length + 2, afterFirst.join(","));
  check(
    "the inserted steps did NOT reuse the fragment's own ids",
    !afterFirst.includes("src-fill") && !afterFirst.includes("src-click"),
    afterFirst.join(",")
  );
  check("the destination's original steps are all still present", baseIds.every((id) => afterFirst.includes(id)));

  await insertOpen.click();
  await insertDialog.waitFor({ state: "visible", timeout: 10000 });
  await win.getByTestId("fragment-row-seeded-pair").click();
  await win.waitForFunction(
    () => document.querySelectorAll('[data-testid="fragment-audit-pending"]').length === 0,
    undefined,
    { timeout: 10000 }
  );
  await win.getByTestId("fragment-insert-confirm").click();
  await insertDialog.waitFor({ state: "detached", timeout: 10000 });
  await win.waitForFunction(
    (count) => document.querySelectorAll(".awkit-flow-node:not(.is-exiting)").length === count + 4,
    baseIds.length,
    { timeout: 10000 }
  );
  const afterSecond = await canvasNodeIds(win);
  check("inserting the same fragment twice adds a second copy", afterSecond.length === baseIds.length + 4);
  check("no two canvas steps share an id", new Set(afterSecond).size === afterSecond.length, afterSecond.join(","));
  check("the first copy was not overwritten", afterFirst.every((id) => afterSecond.includes(id)));

  await win.getByTestId("flow-undo").click();
  await win.waitForFunction(
    (count) => document.querySelectorAll(".awkit-flow-node:not(.is-exiting)").length === count + 2,
    baseIds.length,
    { timeout: 10000 }
  );
  check("undo restored the graph to one inserted copy", (await canvasNodeIds(win)).length === baseIds.length + 2);
  await win.getByTestId("flow-redo").click();
  await win.waitForFunction(
    (count) => document.querySelectorAll(".awkit-flow-node:not(.is-exiting)").length === count + 4,
    baseIds.length,
    { timeout: 10000 }
  );
  check("redo restored the second inserted copy", (await canvasNodeIds(win)).length === baseIds.length + 4);

  console.log("\n7. Save, and read the result back off disk");
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForFunction(
    (id) => {
      const badge = document.querySelector(".editor-command-state");
      return badge !== null && id.length > 0;
    },
    DEST_FLOW_ID,
    { timeout: 10000 }
  );
  await win.waitForTimeout(1200);
  const savedDest = readFlow(DEST_FLOW_ID);
  check(
    "the saved flow holds the destination's steps plus four inserted ones",
    savedDest.nodes.length === destFlow.nodes.length + 4,
    `${savedDest.nodes.length} nodes`
  );
  check("no two saved steps share an id", new Set(savedDest.nodes.map((node) => node.id)).size === savedDest.nodes.length);
  const savedFills = savedDest.nodes.filter((node) => node.type === "fill");
  check("both inserted fill steps were saved", savedFills.length === 2);
  check(
    "the resilient locator survived insert → save → disk",
    savedFills.every((node) => node.locator?.strategy === "role" && node.locator?.name === "Username"),
    JSON.stringify(savedFills.map((node) => node.locator))
  );
  check(
    "the runtime-input binding survived and was not rebound to an empty value",
    savedFills.every((node) => node.valueSource?.type === "runtimeInput" && node.valueSource?.key === "username"),
    JSON.stringify(savedFills.map((node) => node.valueSource))
  );
  check(
    "the failure policy survived",
    savedFills.every((node) => node.onFailure?.action === "stop")
  );
  const insertedEdges = savedDest.edges.filter((edge) => edge.id !== "d-edge");
  check("both internal connectors were inserted and remapped", insertedEdges.length === 2);
  check(
    "no inserted connector points at a step the flow does not contain",
    insertedEdges.every(
      (edge) =>
        savedDest.nodes.some((node) => node.id === edge.source) && savedDest.nodes.some((node) => node.id === edge.target)
    )
  );

  console.log("\n8. Protected login is refused at capture, and nothing is written");
  await openFlow(win, "L6 protected");
  const beforeProtected = fragmentsOnDisk().length;
  await saveOpen.click();
  await saveDialog.waitFor({ state: "visible", timeout: 10000 });
  await win.getByTestId("fragment-step-prot-login").check();
  await win.getByTestId("fragment-save-name").fill("Should never exist");
  await win.getByTestId("fragment-save-confirm").click();
  await win.waitForSelector(".app-toast-error", { timeout: 10000 });
  check(
    "the app refused the protected-login capture",
    (await win.locator(".app-toast-error").first().textContent())?.includes("cannot be saved") === true
  );
  check("no fragment file was written", fragmentsOnDisk().length === beforeProtected);
  check(
    "the refusal left the dialog open rather than reporting success",
    await saveDialog.count() === 1
  );
  await win.keyboard.press("Escape");

  /* A disabled control is a courtesy, not a boundary. These calls go straight down the real IPC
   * channels with the dialog closed, which is exactly what a renderer defect — or a renderer that
   * simply ignores its own preview — would do. The refusal has to come from main. */
  console.log("\n9. The trusted boundary refuses independently of any renderer control");
  const destBeforeDirect = readFlow(DEST_FLOW_ID);
  const directApply = await win.evaluate(
    ([flowId, fragmentId]) => window.playwrightFlowStudio.fragments.apply(flowId, fragmentId),
    [DEST_FLOW_ID, "seeded-recursive"] as const
  );
  check("fragments:apply refuses a blocking fragment over direct IPC", directApply.ok === false);
  check(
    "the refusal names the rule rather than a generic error",
    directApply.findings.some((entry) => entry.code === "recursiveFlowReference" && entry.severity === "blocking"),
    JSON.stringify(directApply.findings.map((entry) => entry.code))
  );
  const destAfterDirect = readFlow(DEST_FLOW_ID);
  check(
    "the refused apply wrote NOTHING to the stored flow",
    JSON.stringify(destAfterDirect) === JSON.stringify(destBeforeDirect),
    `${destBeforeDirect.nodes.length} → ${destAfterDirect.nodes.length} nodes`
  );

  const beforeDirectCapture = fragmentsOnDisk().length;
  const directCapture = await win.evaluate(
    ([flowId, nodeId]) =>
      window.playwrightFlowStudio.fragments.capture({
        flowId,
        id: "direct-protected-attempt",
        name: "Direct protected attempt",
        nodeIds: [nodeId]
      }),
    [PROTECTED_FLOW_ID, "prot-login"] as const
  );
  check("fragments:capture refuses a protected-login step over direct IPC", directCapture.ok === false);
  check(
    "the refusal is the protected-login rule",
    directCapture.findings.some((entry) => entry.code === "protectedLoginStep" && entry.severity === "blocking"),
    JSON.stringify(directCapture.findings.map((entry) => entry.code))
  );
  check("no fragment file was created by the refused capture", fragmentsOnDisk().length === beforeDirectCapture);

  console.log("\n10. No renderer errors along the way");
  check(`the renderer logged no console errors (${console_.errors.length})`, console_.errors.length === 0, console_.summary());
} catch (error) {
  failed += 1;
  console.error(`\n  ✗ the suite aborted — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await app?.close().catch(() => undefined);
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
