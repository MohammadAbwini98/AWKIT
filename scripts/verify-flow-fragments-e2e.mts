/**
 * verify:flow-fragments-e2e — a fragment's whole life, from the real Flow Designer to the real runner.
 *
 * `verify:flow-fragments` proves the contract and the audit as pure functions. `verify:flow-fragments-gui`
 * proves a user can reach capture and insertion in the real app. Neither proves the thing the milestone
 * actually promises: that a fragment captured in the editor, inserted into another flow, wired up, saved
 * and reopened still EXECUTES — that its locators still resolve against a live page, that its runtime-input
 * binding is satisfied by the workflow that owns it, and that the run report names the inserted steps
 * rather than the fragment's own.
 *
 * So this suite goes the whole way: real Electron, real permission-gated IPC, real files on disk, the real
 * drag-to-connect gesture, `execution:runWorkflow` with `dryRun: false`, the bundled Chromium, and the local
 * Feature Test Lab. The outcome is then read back from THREE independent places, none of which is the app's
 * opinion of itself:
 *
 *   1. the flow JSON on disk,
 *   2. the run report the engine wrote under the isolated runtime root,
 *   3. the mock site's own `/success` page, fetched from Node — the target application's state.
 *
 * A fragment inserted but never connected is an orphan, so the suite WIRES IT UP the way a user does:
 * drag-to-connect on the canvas, twice. That gesture is asserted after every drag, so a drag that silently
 * did nothing fails a check rather than quietly reducing the run to "start → end".
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:flow-fragments-e2e
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type Page } from "playwright";

import { auditFragment, isFragmentBlocked } from "@src/fragments/FlowFragment";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";

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
const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}`;

// PRODUCTION_OFFLINE pins the run to the bundled Chromium under `resources/browsers`, which is what a
// shipped run uses. Without it a dev run would silently resolve a different browser than the product does.
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-l6-fragments-e2e", {
  PRODUCTION_OFFLINE: "true"
});
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
 * One runnable source flow against the Feature Test Lab's form, one empty destination, and one
 * workflow that declares the runtime input the fragment's steps bind. The workflow is what owns
 * `runtimeInputs` — a flow has no such declaration, and inventing one here would be the parallel
 * binding system the milestone forbids.
 */
const SOURCE_FLOW_ID = "l6e2e-source";
const DEST_FLOW_ID = "l6e2e-dest";
const WORKFLOW_ID = "l6e2e-workflow";
const RUNTIME_KEY = "firstName";
const RUNTIME_VALUE = "FragmentRuntimeAlice";
const STATIC_LAST_NAME = "InsertedFragment";
/** The step ids that become the fragment. Every inserted copy is `<id>-<token>`, never these. */
const BODY_IDS = ["body-goto", "body-first", "body-last", "body-terms", "body-submit", "body-assert"] as const;

const step = (over: Partial<FlowStep> & Pick<FlowStep, "id" | "type" | "name">): FlowStep => ({
  position: { x: 280, y: 140 },
  ...over
});

/**
 * The six steps that travel. `body-first` deliberately carries BOTH a resilient role locator with
 * recorder provenance AND a `runtimeInput` binding, so a loss of either is visible at run time and not
 * only in the JSON: a dropped locator makes the fill fail, and a dropped binding makes the final
 * assertion fail because the page would echo the wrong value.
 */
const bodySteps: FlowStep[] = [
  step({
    id: "body-goto",
    type: "goto",
    name: "Open the form",
    url: `${BASE}/form`,
    valueSource: { type: "static", value: `${BASE}/form` },
    timeoutMs: 30000
  }),
  step({
    id: "body-first",
    type: "fill",
    name: "First name from the runtime input",
    locator: {
      strategy: "role",
      value: "textbox",
      name: "First name",
      exact: true,
      resolution: "resolved",
      resolvedBy: "recorder",
      quality: { strategy: "role", isUnique: true, matchCount: 1, confidence: "high" }
    },
    valueSource: { type: "runtimeInput", key: RUNTIME_KEY },
    onFailure: { action: "stop", screenshot: true }
  }),
  step({
    id: "body-last",
    type: "fill",
    name: "Last name",
    locator: { strategy: "id", value: "lastName", resolution: "resolved", resolvedBy: "recorder" },
    valueSource: { type: "static", value: STATIC_LAST_NAME }
  }),
  step({ id: "body-terms", type: "check", name: "Accept the terms", locator: { strategy: "id", value: "acceptTerms" } }),
  step({ id: "body-submit", type: "click", name: "Submit", locator: { strategy: "id", value: "submitButton" } }),
  step({
    id: "body-assert",
    type: "assertText",
    name: "The page echoes the runtime value",
    locator: { strategy: "id", value: "submittedFirstName" },
    valueSource: { type: "runtimeInput", key: RUNTIME_KEY },
    config: { assertionType: "text", comparisonOperator: "equals" },
    timeoutMs: 10000
  })
];

const chain = (ids: string[], prefix: string) =>
  ids.slice(0, -1).map((source, index) => ({ id: `${prefix}-${index}`, source, target: ids[index + 1]!, type: "success" as const }));

const sourceFlow: FlowProfile = {
  id: SOURCE_FLOW_ID,
  name: "L6 e2e source",
  description: "Seeded for verify:flow-fragments-e2e",
  version: 1,
  nodes: [
    step({ id: "start", type: "start", name: "Start", position: { x: 280, y: 40 } }),
    ...bodySteps,
    step({ id: "end", type: "end", name: "End", position: { x: 280, y: 900 } })
  ],
  edges: chain(["start", ...BODY_IDS, "end"], "src-e")
};

/** Two terminals and nothing else: everything the run executes has to arrive from the fragment. */
const destFlow: FlowProfile = {
  id: DEST_FLOW_ID,
  name: "L6 e2e destination",
  description: "Seeded for verify:flow-fragments-e2e",
  version: 1,
  nodes: [
    step({ id: "start", type: "start", name: "Start", position: { x: 200, y: 60 } }),
    step({ id: "end", type: "end", name: "End", position: { x: 620, y: 60 } })
  ],
  edges: []
};

const workflow = {
  id: WORKFLOW_ID,
  name: "L6 e2e workflow",
  description: "Runs the destination flow the fragment was inserted into.",
  version: 1,
  nodes: [
    {
      id: "dest-ref",
      type: "flowRef",
      flowId: DEST_FLOW_ID,
      alias: "Destination",
      order: 1,
      required: true,
      inputBindings: {},
      retryPolicy: { count: 0, delayMs: 0 },
      failurePolicy: "stop",
      position: { x: 0, y: 0 }
    }
  ],
  edges: [],
  runtimeInputs: [{ key: RUNTIME_KEY, label: "First name", type: "text", required: true }],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
};

/* A seeded fixture that is not what it claims voids whole sections silently, so audit it at seed time
 * against the same authority the product uses. */
const seededFragmentShape = {
  id: "seed-probe",
  name: "Seed probe",
  kind: "fragment" as const,
  version: 1,
  nodes: bodySteps,
  edges: chain([...BODY_IDS], "frag-e"),
  inputs: [{ key: RUNTIME_KEY, label: RUNTIME_KEY, type: "text" as const, required: true }]
};
if (isFragmentBlocked(auditFragment(seededFragmentShape))) {
  throw new Error(
    `the six seeded body steps do not audit clean as a fragment, so the capture section would be meaningless: ${JSON.stringify(
      auditFragment(seededFragmentShape).map((entry) => entry.code)
    )}`
  );
}

mkdirSync(path.join(appData, "flows"), { recursive: true });
mkdirSync(path.join(appData, "workflows"), { recursive: true });
for (const flow of [sourceFlow, destFlow]) {
  writeFileSync(path.join(appData, "flows", `${flow.id}.json`), JSON.stringify(flow, null, 2), "utf8");
}
writeFileSync(path.join(appData, "workflows", `${WORKFLOW_ID}.json`), JSON.stringify(workflow, null, 2), "utf8");

const readFlow = (id: string): FlowProfile =>
  JSON.parse(readFileSync(path.join(appData, "flows", `${id}.json`), "utf8")) as FlowProfile;
const fragmentsOnDisk = (): string[] => {
  try {
    return readdirSync(path.join(appData, "fragments")).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
};
const reportsOnDisk = (): string[] => {
  try {
    return readdirSync(path.join(appData, "reports")).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
};
const readReport = (file: string): ConcurrentRunReport =>
  JSON.parse(readFileSync(path.join(appData, "reports", file), "utf8")) as ConcurrentRunReport;

/** Every step id the report says ran, across every instance and flow. */
function executedStepIds(report: ConcurrentRunReport): string[] {
  const ids: string[] = [];
  for (const instance of report.instances ?? []) {
    for (const flow of instance.scenarioResult?.flows ?? []) {
      for (const stepResult of flow.steps ?? []) ids.push(stepResult.stepId);
    }
  }
  return ids;
}

type Submission = { id: string; firstName?: string; lastName?: string };
/** What the Feature Test Lab actually holds — the target application's own state, not the app's. */
const listSubmissions = async (): Promise<{ count: number; submissions: Submission[] }> =>
  (await (await fetch(`${BASE}/api/submissions`)).json()) as { count: number; submissions: Submission[] };

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/form`)).ok) return;
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the Feature Test Lab did not start at ${BASE}`);
}

/** Poll for a NEW report file. The engine writes it when the run completes; nothing else does. */
async function waitForNewReport(before: Set<string>, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = reportsOnDisk().filter((name) => !before.has(name));
    if (fresh.length > 0) {
      // The store writes the whole document atomically, but give the last byte a beat before parsing.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return fresh[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("no run report was written within the timeout");
}

/** Poll until the report for THIS execution exists, so a different run's report cannot end the wait. */
async function waitForReportOf(executionId: string, timeoutMs = 120_000): Promise<ConcurrentRunReport> {
  if (!executionId) throw new Error("no executionId to wait for; the run was never admitted");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const file of reportsOnDisk()) {
      try {
        const report = readReport(file);
        if (report.executionId === executionId) return report;
      } catch {
        /* a report still being written */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`no report for execution "${executionId}" was written within the timeout`);
}

const canvasNodeIds = (win: Page): Promise<string[]> =>
  win.evaluate(() =>
    [...document.querySelectorAll(".awkit-flow-node:not(.is-exiting)")]
      .map((node) => node.getAttribute("data-id") ?? "")
      .filter(Boolean)
  );

/** The article inside the card: the node's real visual box, without the leaf "append" affordance. */
const cardBox = async (win: Page, id: string) => {
  const box = await win.locator(`.awkit-flow-node[data-id="${id}"] .action-flow-node`).boundingBox();
  if (!box) throw new Error(`node "${id}" has no bounding box on the canvas`);
  return box;
};

/**
 * The product's own drag-to-connect: pick a node up and drop it on another. The pointer goes down on the
 * left third of the card, clear of the kebab button, which stops propagation and would swallow the drag.
 */
async function dragCard(win: Page, id: string, to: { x: number; y: number }): Promise<void> {
  const box = await cardBox(win, id);
  await win.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await win.mouse.down();
  // Several intermediate moves: one jump would clear the 3px drag threshold but gives React no frame to
  // latch the gesture, and pointer capture needs at least one move before the up.
  await win.mouse.move(to.x, to.y, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(250);
}

async function connectByDrag(win: Page, dragId: string, ontoId: string, expectLabel: string): Promise<void> {
  const target = await cardBox(win, ontoId);
  await dragCard(win, dragId, { x: target.x + target.width * 0.5, y: target.y + target.height * 0.5 });
  const prompt = win.getByRole("alertdialog");
  await prompt.waitFor({ state: "visible", timeout: 10000 });
  check(`the drag over "${ontoId}" offered to connect (${expectLabel})`, (await prompt.textContent())?.includes("Connect") === true);
  await prompt.getByRole("button", { name: "Connect", exact: true }).click();
  await prompt.waitFor({ state: "detached", timeout: 10000 });
}

const openFlow = async (win: Page, name: string): Promise<void> => {
  // Assert the menu is CLOSED before clicking the trigger, because the trigger toggles: a control that
  // silently stayed open after the last selection would be closed by this click, and the suite would
  // report a missing option instead of the state defect that caused it.
  const expandedBefore = await win.getByRole("button", { name: "Saved flow" }).getAttribute("aria-expanded");
  if (expandedBefore !== "false") {
    throw new Error(`the Saved flow control was still open (aria-expanded="${expandedBefore}") before opening "${name}"`);
  }
  await win.getByRole("button", { name: "Saved flow" }).click();
  const menu = win.getByRole("listbox");
  await menu.waitFor({ state: "visible", timeout: 10000 });
  const option = menu.getByRole("option", { name, exact: false });
  try {
    await option.waitFor({ state: "visible", timeout: 10000 });
  } catch {
    throw new Error(
      `"${name}" was not offered by the Saved flow list; it offered ${JSON.stringify(
        await menu.getByRole("option").allInnerTexts()
      )}`
    );
  }
  await option.click();
  // Choosing must CLOSE the popup. It is stated here rather than left implicit because every caller
  // mounts this control inside a <label>, whose activation behavior re-dispatches a synthetic click
  // onto the trigger and re-opened the menu the instant a selection closed it.
  await menu.waitFor({ state: "detached", timeout: 5000 });
  // Observable sync instead of a sleep: the trigger renders the SELECTED option's label, which is
  // driven by `flowId`, and `loadProfile` sets `flowId` and the canvas nodes in one commit — so the
  // trigger showing this flow's name means the loaded graph is already in the DOM.
  await win.waitForFunction(
    (expected) =>
      document.querySelector(".editor-identity-select .searchable-select-trigger span")?.textContent?.trim() === expected,
    name,
    { timeout: 10000 }
  );
};

/**
 * Click Save and wait for the FILE to change, not for a clock. `updatedAt` is stamped on every save, so
 * a save that silently failed leaves the previous document in place and this times out rather than
 * letting the next section assert against a stale read.
 */
const saveFlow = async (win: Page, flowId: string): Promise<void> => {
  const before = readFlow(flowId).updatedAt ?? "";
  await win.getByRole("button", { name: "Save", exact: true }).click();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((readFlow(flowId).updatedAt ?? "") !== before) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Save did not write a new updatedAt for "${flowId}" within 20s`);
};

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let server: ChildProcess | undefined;
try {
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: root,
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore",
    windowsHide: true
  });
  await waitForServer();

  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);
  console_.setLabel("flow designer");
  await navClick(win, "Flow Designer");

  console.log("\n1. Capture the executable body of a real flow as a fragment");
  const saveOpen = win.getByTestId("fragment-save-open");
  await saveOpen.waitFor({ state: "visible", timeout: 15000 });
  await openFlow(win, "L6 e2e source");
  await saveOpen.click();
  const saveDialog = win.getByTestId("fragment-save-dialog");
  await saveDialog.waitFor({ state: "visible", timeout: 10000 });
  for (const id of BODY_IDS) await win.getByTestId(`fragment-step-${id}`).check();
  await win.getByTestId("fragment-save-name").fill("E2E form body");
  await win.getByTestId("fragment-save-confirm").click();
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="fragment-save-dialog"]').length === 0, undefined, {
    timeout: 10000
  });
  const capturedFile = fragmentsOnDisk().find((name) => name.startsWith("e2e-form-body-"));
  check("capture wrote exactly one fragment file", fragmentsOnDisk().length === 1, fragmentsOnDisk().join(","));
  check("the captured fragment is named from the user's title", capturedFile !== undefined, fragmentsOnDisk().join(","));
  if (!capturedFile) throw new Error("capture produced no fragment file; the rest of the suite has nothing to insert");
  const capturedId = capturedFile.replace(/\.json$/, "");
  const captured = JSON.parse(readFileSync(path.join(appData, "fragments", capturedFile), "utf8")) as typeof seededFragmentShape;
  check("all six executable steps were captured", captured.nodes.length === 6, `${captured.nodes.length} nodes`);
  check("the five internal connectors were captured", captured.edges.length === 5, `${captured.edges.length} edges`);
  check(
    "the runtime input the steps bind was derived into the declaration",
    captured.inputs.length === 1 && captured.inputs[0]?.key === RUNTIME_KEY,
    JSON.stringify(captured.inputs)
  );
  check(
    "the resilient role locator and its recorder provenance survived capture",
    captured.nodes.find((node) => node.id === "body-first")?.locator?.name === "First name" &&
      captured.nodes.find((node) => node.id === "body-first")?.locator?.resolvedBy === "recorder"
  );
  check("capture did not modify the source flow", readFlow(SOURCE_FLOW_ID).nodes.length === sourceFlow.nodes.length);

  console.log("\n2. Insert it into an empty destination through the real designer");
  await openFlow(win, "L6 e2e destination");
  const baseIds = await canvasNodeIds(win);
  check("the destination starts with only its two terminals", baseIds.length === 2, baseIds.join(","));
  await win.getByTestId("fragment-insert-open").click();
  const insertDialog = win.getByTestId("fragment-insert-dialog");
  await insertDialog.waitFor({ state: "visible", timeout: 10000 });
  await win.getByTestId(`fragment-row-${capturedId}`).click();
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="fragment-audit-pending"]').length === 0, undefined, {
    timeout: 10000
  });
  check("the fragment's required runtime input is shown to the user", await win.getByTestId("fragment-required-inputs").count() === 1);
  check("Insert is offered for a fragment this destination can take", await win.getByTestId("fragment-insert-confirm").isEnabled());
  await win.getByTestId("fragment-insert-confirm").click();
  await insertDialog.waitFor({ state: "detached", timeout: 10000 });
  await win.waitForFunction(
    (count) => document.querySelectorAll(".awkit-flow-node:not(.is-exiting)").length === count + 6,
    baseIds.length,
    { timeout: 10000 }
  );
  const afterInsert = await canvasNodeIds(win);
  const insertedIds = afterInsert.filter((id) => !baseIds.includes(id));
  check("six steps arrived on the canvas", insertedIds.length === 6, insertedIds.join(","));
  check(
    "not one inserted step reused the fragment's own id",
    BODY_IDS.every((id) => !insertedIds.includes(id)),
    insertedIds.join(",")
  );
  const headId = insertedIds.find((id) => id.startsWith("body-goto-"));
  const tailId = insertedIds.find((id) => id.startsWith("body-assert-"));
  check("the inserted head and tail are identifiable", headId !== undefined && tailId !== undefined, insertedIds.join(","));
  if (!headId || !tailId) throw new Error("the inserted chain has no identifiable head/tail; wiring cannot proceed");

  console.log("\n3. Wire the inserted steps in with the canvas's own drag-to-connect");
  // Auto-arrange re-runs the same deterministic layered layout and frames the whole graph, so every card
  // is on screen and the rows are where the layout says they are before any pointer maths.
  await win.getByRole("button", { name: "Auto-arrange steps" }).click();
  await win.waitForTimeout(900);
  // Start and the inserted head both have no incoming connector, so the layout puts them on the same row;
  // the designer reads direction from the pre-drag y, so dragging Start onto the head yields Start → head.
  await connectByDrag(win, "start", headId, "Start → the fragment's first step");
  // End is on that row too. Move it below the chain first, or the same rule would produce End → tail and
  // the designer would refuse to point a connector out of End.
  const tailBoxBefore = await cardBox(win, tailId);
  await dragCard(win, "end", { x: tailBoxBefore.x + tailBoxBefore.width * 1.15, y: tailBoxBefore.y + tailBoxBefore.height * 1.6 });
  check("moving End to clear space raised no connect prompt", await win.getByRole("alertdialog").count() === 0);
  await connectByDrag(win, tailId, "end", "the fragment's last step → End");

  console.log("\n4. Save, and read the wired graph back off disk");
  await saveFlow(win, DEST_FLOW_ID);
  const savedDest = readFlow(DEST_FLOW_ID);
  check("the saved flow holds both terminals and all six inserted steps", savedDest.nodes.length === 8, `${savedDest.nodes.length} nodes`);
  check("no two saved steps share an id", new Set(savedDest.nodes.map((node) => node.id)).size === savedDest.nodes.length);
  check(
    "the five inserted connectors were remapped onto the new ids",
    savedDest.edges.filter((edge) => insertedIds.includes(edge.source) && insertedIds.includes(edge.target)).length === 5,
    JSON.stringify(savedDest.edges.map((edge) => `${edge.source}→${edge.target}`))
  );
  check(
    "the user's Start connector was persisted",
    savedDest.edges.some((edge) => edge.source === "start" && edge.target === headId),
    JSON.stringify(savedDest.edges.map((edge) => `${edge.source}→${edge.target}`))
  );
  check(
    "the user's End connector was persisted",
    savedDest.edges.some((edge) => edge.source === tailId && edge.target === "end")
  );
  check(
    "no saved connector points at a step the flow does not contain",
    savedDest.edges.every(
      (edge) => savedDest.nodes.some((node) => node.id === edge.source) && savedDest.nodes.some((node) => node.id === edge.target)
    )
  );
  const savedFirst = savedDest.nodes.find((node) => node.id.startsWith("body-first-"));
  check(
    "the resilient locator survived insert → wire → save → disk",
    savedFirst?.locator?.strategy === "role" && savedFirst?.locator?.name === "First name",
    JSON.stringify(savedFirst?.locator)
  );
  check(
    "the runtime-input binding was not rebound or emptied",
    savedFirst?.valueSource?.type === "runtimeInput" && savedFirst?.valueSource?.key === RUNTIME_KEY,
    JSON.stringify(savedFirst?.valueSource)
  );
  check("the failure policy survived", savedFirst?.onFailure?.action === "stop");

  console.log("\n5. Close the flow, reopen it, and edit and re-save what came back");
  await openFlow(win, "L6 e2e source");
  await openFlow(win, "L6 e2e destination");
  const reopened = await canvasNodeIds(win);
  check("every persisted step came back on reload", reopened.length === 8, reopened.join(","));
  check("the inserted ids are the ones that came back", insertedIds.every((id) => reopened.includes(id)), reopened.join(","));
  await win.locator(".editor-identity-name input").fill("L6 e2e destination edited");
  await saveFlow(win, DEST_FLOW_ID);
  const edited = readFlow(DEST_FLOW_ID);
  check("re-saving an edited flow that contains a fragment kept every step", edited.nodes.length === 8, `${edited.nodes.length} nodes`);
  check("re-saving kept every connector", edited.edges.length === savedDest.edges.length, `${edited.edges.length} edges`);
  check("the edit itself was persisted", edited.name === "L6 e2e destination edited", edited.name);

  console.log("\n6. Run the destination flow for real, through the workflow that declares its input");
  const reportsBefore = new Set(reportsOnDisk());
  const started = await win.evaluate(
    ([workflowId, key, value]) =>
      window.playwrightFlowStudio.executions.runWorkflow({
        workflowId,
        dryRun: false,
        headless: true,
        totalInstances: 1,
        maxConcurrentInstances: 1,
        isolationMode: "browserContext",
        stopOnError: true,
        screenshotOnFailure: true,
        runtimeInputs: { [key]: value }
      }) as Promise<{ status: string; executionId?: string }>,
    [WORKFLOW_ID, RUNTIME_KEY, RUNTIME_VALUE] as const
  );
  check("the run was admitted", started?.status === "started", JSON.stringify(started));
  const reportFile = await waitForNewReport(reportsBefore);
  const report = readReport(reportFile);
  const ranIds = executedStepIds(report);
  check(`the run passed (${report.status})`, report.status === "passed", report.instances?.[0]?.error ?? "");
  check(
    "the report names the INSERTED step ids, not the fragment's own",
    insertedIds.every((id) => ranIds.includes(id)),
    `ran ${JSON.stringify([...new Set(ranIds)])}`
  );
  check(
    "the fragment's own ids never appear in the report",
    BODY_IDS.every((id) => !ranIds.includes(id)),
    `ran ${JSON.stringify([...new Set(ranIds)])}`
  );
  check(
    "every inserted step is recorded as passed",
    (report.instances ?? []).every((instance) =>
      (instance.scenarioResult?.flows ?? []).every((flow) =>
        (flow.steps ?? []).filter((entry) => insertedIds.includes(entry.stepId)).every((entry) => entry.status === "passed")
      )
    )
  );
  check(
    "the report records the runtime input the run actually used",
    report.runtimeInputs?.[RUNTIME_KEY] === RUNTIME_VALUE,
    JSON.stringify(report.runtimeInputs)
  );

  console.log("\n7. The target application's own state, read from the Feature Test Lab");
  // Ask the server what it HOLDS rather than fetching a guessed id: `/success` renders an empty record
  // for an id it has never seen, so "fetch SUB-n and look for an empty field" passes identically whether
  // the run submitted an empty form or never reached the form at all.
  const submitted = await listSubmissions();
  check("the run submitted exactly one form to the target application", submitted.count === 1, JSON.stringify(submitted));
  check(
    "the workflow's runtime input reached the live page through the inserted fragment step",
    submitted.submissions[0]?.firstName === RUNTIME_VALUE,
    JSON.stringify(submitted.submissions[0])
  );
  check(
    "the fragment's static binding reached the live page too",
    submitted.submissions[0]?.lastName === STATIC_LAST_NAME,
    JSON.stringify(submitted.submissions[0])
  );
  // …and the page the run actually asserted against renders those values, which is the observable
  // result a user would see.
  const success = await (await fetch(`${BASE}/success?id=${encodeURIComponent(submitted.submissions[0]?.id ?? "")}`)).text();
  check(
    "the success page renders the submitted values",
    success.includes(`id="submittedFirstName">${RUNTIME_VALUE}<`) && success.includes(`id="submittedLastName">${STATIC_LAST_NAME}<`),
    success.slice(success.indexOf("submittedFirstName"), success.indexOf("submittedFirstName") + 80)
  );

  console.log("\n8. A required runtime input the destination cannot supply refuses the run");
  const reportsBeforeRefusal = new Set(reportsOnDisk());
  const refused = await win.evaluate(
    (workflowId) =>
      window.playwrightFlowStudio.executions.runWorkflow({
        workflowId,
        dryRun: false,
        headless: true,
        totalInstances: 1,
        maxConcurrentInstances: 1,
        isolationMode: "browserContext",
        stopOnError: true
      }) as Promise<{ status: string; validation?: { valid?: boolean; issues?: { key: string; message: string; blocking: boolean }[] } }>,
    WORKFLOW_ID
  );
  check(
    "a run missing a declared required input is refused, not silently given an empty value",
    refused?.status === "validationFailed",
    JSON.stringify(refused?.status)
  );
  check(
    "the refusal names the unsatisfied input rather than a generic error",
    (refused?.validation?.issues ?? []).some((issue) => issue.key === `runtime.${RUNTIME_KEY}` && issue.blocking),
    JSON.stringify((refused?.validation?.issues ?? []).map((issue) => issue.key))
  );
  // A refusal is the ABSENCE of an effect, and absence needs a clock you can trust. Sleeping for a
  // multiple of the measured run time is not one: at twice a real run the admitted-by-mutation run had
  // still not reached the form, so both assertions below passed while the defect was present. Instead
  // issue a VALID control run and wait for ITS report — once a run started AFTER the refused one has
  // completed and posted its form, anything the refused run was going to do has had longer than that.
  const control = await win.evaluate(
    ([workflowId, key, value]) =>
      window.playwrightFlowStudio.executions.runWorkflow({
        workflowId,
        dryRun: false,
        headless: true,
        totalInstances: 1,
        maxConcurrentInstances: 1,
        isolationMode: "browserContext",
        stopOnError: true,
        runtimeInputs: { [key]: value }
      }) as Promise<{ status: string; executionId?: string }>,
    [WORKFLOW_ID, RUNTIME_KEY, RUNTIME_VALUE] as const
  );
  check("the control run that follows the refusal was admitted", control?.status === "started", JSON.stringify(control));
  // Wait for the CONTROL's own report, identified by its executionId — not merely for "a new report",
  // which a report written by the refused run would satisfy first and so hide the very thing being
  // checked.
  await waitForReportOf(control?.executionId ?? "");
  check(
    "the refused run wrote no report, so it can never be read as a successful execution",
    reportsOnDisk().filter((name) => !reportsBeforeRefusal.has(name)).length === 1,
    `${reportsOnDisk().filter((name) => !reportsBeforeRefusal.has(name)).length} new reports; only the control run may have written one`
  );
  const afterRefusal = await listSubmissions();
  check(
    "the refused run submitted nothing to the target application",
    afterRefusal.count === submitted.count + 1,
    `${afterRefusal.count} submissions now, ${submitted.count} before the refusal and one from the control run`
  );

  console.log("\n9. The trusted boundary, with no dialog and no editor in the way");
  const beforeMissing = JSON.stringify(readFlow(DEST_FLOW_ID));
  const missingFlow = await win.evaluate(
    (fragmentId) => window.playwrightFlowStudio.fragments.apply("l6e2e-no-such-flow", fragmentId),
    capturedId
  );
  check("applying into a flow that does not exist is refused", missingFlow.ok === false);
  check(
    "the refusal names the missing flow rather than throwing",
    missingFlow.findings.some((entry) => entry.severity === "blocking" && entry.message.includes("l6e2e-no-such-flow")),
    JSON.stringify(missingFlow.findings.map((entry) => entry.message))
  );
  check("the destination was left exactly as it was", JSON.stringify(readFlow(DEST_FLOW_ID)) === beforeMissing);

  // Two applies in flight at once on the same flow. `fragments:apply` is one compare-and-swap in the flow
  // folder's lane, so the second must observe the first: twelve inserted steps, not six, and no lost update.
  const concurrent = await win.evaluate(
    ([flowId, fragmentId]) =>
      Promise.all([
        window.playwrightFlowStudio.fragments.apply(flowId, fragmentId),
        window.playwrightFlowStudio.fragments.apply(flowId, fragmentId)
      ]),
    [DEST_FLOW_ID, capturedId] as const
  );
  check("both concurrent applies were accepted", concurrent.every((result) => result.ok === true), JSON.stringify(concurrent.map((r) => r.ok)));
  const afterConcurrent = readFlow(DEST_FLOW_ID);
  check(
    "neither concurrent apply overwrote the other",
    afterConcurrent.nodes.length === 20,
    `${afterConcurrent.nodes.length} nodes (8 + 6 + 6 expected)`
  );
  check(
    "no two steps collide after two concurrent applies",
    new Set(afterConcurrent.nodes.map((node) => node.id)).size === afterConcurrent.nodes.length
  );

  console.log("\n10. No renderer errors along the way");
  check(`the renderer logged no console errors (${console_.errors.length})`, console_.errors.length === 0, console_.summary());
} catch (error) {
  failed += 1;
  console.error(`\n  ✗ the suite aborted — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await app?.close().catch(() => undefined);
  if (server && !server.killed) server.kill();
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
