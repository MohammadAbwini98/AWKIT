import { _electron as electron } from "playwright";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  loopCapsuleMovedWithNode,
  matchesLoopCapsuleContract,
  readLoopCapsuleMotion,
  readLoopCapsulePixelMotion,
  readLoopCapsuleVisual,
  rejectsLoopURouteHybrid,
  waitForLoopCapsuleLayoutStable
} from "./loop-capsule-visual-oracle.mjs";
import {
  DEFAULT_CREDS,
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun,
  waitForAsyncCondition
} from "./gui-verify-harness.mjs";

const WF_SELECT = 'label.sb-toolbar-field:has(span:text-is("Workflow")) select';

export const WORKFLOW_LOOP_CAPSULE_CHECK_NAMES = Object.freeze([
  "Workflow Loop default renders the approved capsule, dominant ring, configured value, and sweep",
  "Workflow Loop capsule oracle rejects the superseded U-route hybrid",
  "Workflow dense-layout scoring chooses the clear side and fit keeps the complete control visible",
  "Workflow Loop recomputes its clear side when a neighboring node moves away and back",
  "Workflow Loop keeps mode-aware design text while the ring displays maxIterations",
  "Workflow Loop uses same-side capsule attachment and never the full-node U-route",
  "Workflow Loop rotates only the circular sweep without moving value, label, or capsule geometry",
  "Workflow Loop reduced motion freezes only the sweep and leaves capsule/value readable",
  "Workflow Loop capsule remains attached and structurally identical through zoom and viewport pan",
  "Dragging the Workflow node preserves capsule attachment, ring/value ownership, and geometry",
  "Two Workflow Loops keep independent identities, authored state, selection, and moving sweeps",
  "Reduced motion freezes both independent Workflow sweeps without hiding either value or label",
  "Workflow save preserves Loop configuration, authored style, and exactly one promoted Conditional exit",
  "Workflow reload preserves the capsule contract, rendered style, and exact configured value",
  "Workflow dominant ring supports exact config Undo/Redo and a second persisted edit/reload cycle",
  "Workflow Loop stays accessible and Delete/Undo/Redo restores its exact authored state once",
  "Configure loop reopens the Workflow Loop with its unsaved bound edit and authored summary intact"
]);

export function matchesWorkflowLoopCapsuleCheckContract(results) {
  if (!Array.isArray(results) || results.length !== WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length) return false;
  const actualNames = results.map((result) => result?.name);
  return new Set(actualNames).size === WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length &&
    actualNames.every((name, index) => name === WORKFLOW_LOOP_CAPSULE_CHECK_NAMES[index]);
}

function seedWorkflow(dataRoot) {
  const now = new Date().toISOString();
  const root = path.join(dataRoot, "SpecterStudio");
  const flowsDir = path.join(root, "flows");
  const workflowsDir = path.join(root, "workflows");
  mkdirSync(flowsDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });
  const flow = (id, name) => ({
    id, name, description: "Focused Workflow Loop capsule fixture flow.", version: 1, createdAt: now, updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "goto", type: "goto", name: "Open", url: "http://localhost:4321/", valueSource: { type: "static", value: "http://localhost:4321/" } },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "end", type: "success" }
    ]
  });
  writeFileSync(path.join(flowsDir, "capsule-flow-a.json"), `${JSON.stringify(flow("capsule-flow-a", "Capsule Flow A"), null, 2)}\n`);
  writeFileSync(path.join(flowsDir, "capsule-flow-b.json"), `${JSON.stringify(flow("capsule-flow-b", "Capsule Flow B"), null, 2)}\n`);
  writeFileSync(path.join(flowsDir, "capsule-flow-blocker.json"), `${JSON.stringify(flow("capsule-flow-blocker", "Capsule Blocker"), null, 2)}\n`);
  const mkNode = (id, flowId, order, x) => ({
    id, type: "flowRef", flowId, alias: flowId, order, required: true, inputBindings: {},
    retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "stop", position: { x, y: 220 }
  });
  const workflow = {
    id: "verify-workflow-loop-capsule",
    name: "Verify — Workflow Loop Capsule",
    description: "Focused capsule-and-ring Workflow Loop contract fixture.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      mkNode("left-blocker", "capsule-flow-blocker", 1, -160),
      mkNode("workflow-node-1", "capsule-flow-a", 2, 260),
      mkNode("workflow-node-2", "capsule-flow-b", 3, 780)
    ],
    edges: [
      { id: "entry", source: "left-blocker", target: "workflow-node-1", type: "success", label: "always" },
      { id: "exit", source: "workflow-node-1", target: "workflow-node-2", type: "success", label: "always" }
    ],
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
  };
  writeFileSync(path.join(workflowsDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}

async function clickNodeMenuItem(win, nodeId, label) {
  await win.locator(`.awkit-flow-node[data-id="${nodeId}"] .action-node-menu`).click();
  const item = win.locator(".node-options-menu .node-options-item").filter({ hasText: new RegExp(`^${label}$`, "i") }).first();
  await item.waitFor({ state: "visible" });
  await item.click();
}

/**
 * The on-disk workflow, read from Node - deliberately NOT through the app's own bridge.
 *
 * `workflows.get` is the app's view of what it saved. If the app were to report a save that never
 * reached the filesystem, asking the app would agree with the app and prove nothing. This reads the
 * JSON the app claims to have written, so the two can be compared at the moment of failure.
 */
let activeDataRoot = null;
let lastPersistObservation = null;

function readDiskWorkflow() {
  if (!activeDataRoot) return { available: false, reason: "suite did not record its data root" };
  const file = path.join(activeDataRoot, "SpecterStudio", "workflows", "verify-workflow-loop-capsule.json");
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const edges = Array.isArray(raw.edges) ? raw.edges : [];
    return {
      available: true,
      mtimeMs: statSync(file).mtimeMs,
      edges: edges.map((edge) => `${edge.source}->${edge.target}:${edge.type}#${edge.id}`),
      loop: edges.find((edge) => edge.source === edge.target) ?? null
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * The decisive dump for awkit-a53k: the PERSISTED model beside the RENDERED DOM.
 *
 * `loopEdgePresent: false` alone cannot say whether the self-loop edge never reached the renderer or
 * reached it and failed to paint - and that is the entire open question. Reading both sides at the
 * moment of failure separates the three possibilities:
 *   - persistedLoop set, domLoopEdge null   -> reopen drops a persisted edge (the suspected product bug)
 *   - persistedLoop null                    -> the edge did not survive persistence across the reload
 *   - domLoopEdge set, hasIndicator false   -> the edge renders and only its indicator does not
 * Reading the profile through the same preload bridge the app uses keeps this honest: it is the
 * app's own view of what it saved, not a second parser's opinion of the JSON on disk.
 */
async function readModelVsDom(win, nodeId) {
  return win.evaluate(async (id) => {
    const select = document.querySelector('label.sb-toolbar-field select');
    const bridge = window.playwrightFlowStudio;
    let profile = null;
    let profileError = null;
    if (bridge?.workflows?.get) {
      try {
        profile = await bridge.workflows.get("verify-workflow-loop-capsule");
      } catch (error) {
        profileError = String(error);
      }
    }
    const domEdges = [...document.querySelectorAll("g.awkit-flow-edge")].map((edge) => ({
      id: edge.getAttribute("data-id"),
      source: edge.getAttribute("data-source"),
      target: edge.getAttribute("data-target"),
      kind: edge.getAttribute("data-connector-kind"),
      hasIndicator: Boolean(edge.querySelector(".awkit-loop-indicator"))
    }));
    return {
      selectedWorkflow: select instanceof HTMLSelectElement ? select.value : "(no select found)",
      onLoginCard: Boolean(document.querySelector(".awkit-login-card")),
      bridgeAvailable: Boolean(bridge?.workflows?.get),
      profileError,
      persistedFound: Boolean(profile),
      persistedNodes: profile?.nodes?.map((node) => node.id) ?? null,
      persistedEdges: profile?.edges?.map((edge) => `${edge.source}->${edge.target}:${edge.type}#${edge.id}`) ?? null,
      persistedLoop: profile?.edges?.find((edge) => edge.source === id && edge.target === id) ?? null,
      domNodes: [...document.querySelectorAll(".awkit-flow-node")].map((node) => node.getAttribute("data-id")),
      domEdges,
      domLoopEdge: domEdges.find((edge) => edge.source === id && edge.target === id) ?? null
    };
  }, nodeId).catch((error) => ({ readFailed: String(error) }))
    .then((state) => ({ ...state, disk: readDiskWorkflow(), lastPersistObservation }));
}

/**
 * Names which of the awkit-a53k possibilities the dump actually shows.
 *
 * Order matters, and the first version of this got it wrong in a way worth keeping written down.
 * The predicate being waited on is a DOM predicate, so the DOM is read FIRST and the persisted
 * profile is only ever used to explain a DOM edge that is missing. Ordering it the other way made a
 * pre-save wait - where a null persistedLoop is entirely normal, because nothing has been saved yet -
 * report "PERSISTENCE: absent from the saved profile" while the edge and its indicator were both
 * sitting in the canvas. A verdict that confident and that wrong at the decisive moment is exactly
 * the failure mode this whole investigation kept hitting.
 */
function verdictFor(state) {
  if (!state || state.readFailed) return "the diagnostic read itself failed, so nothing is decided";
  if (state.onLoginCard || state.selectedWorkflow !== "verify-workflow-loop-capsule") {
    return "the fixture did not come back after reload - harness restore, not the render path";
  }
  if (state.domLoopEdge?.hasIndicator) {
    return "NOT A RENDER FAULT: the loop edge and its indicator are both in the canvas, so the " +
      "predicate is looking for something the DOM no longer calls by that name (selector drift)";
  }
  if (state.domLoopEdge) return "INDICATOR: the loop edge rendered and only its indicator did not";
  if (!state.persistedFound) return "the workflow profile could not be read back at all";
  if (state.persistedLoop) {
    return "RENDER: the loop edge is in the saved profile but absent from the canvas (awkit-a53k confirmed)";
  }
  if (state.disk?.available && state.disk.loop) {
    return "LOAD: the loop edge is on disk but neither the app's profile nor the canvas has it - " +
      "the reopen read stale or empty state over a file that was written correctly";
  }
  if (state.lastPersistObservation) {
    const observed = state.lastPersistObservation;
    if (observed.disk?.available && observed.disk.loop) {
      return "REVERTED: the loop edge WAS on disk when the save was confirmed (maxIterations=" +
        observed.expected + ") and is gone from disk now - something rewrote the file after the save";
    }
    return "SAVE NEVER REACHED DISK: the app reported maxIterations=" + observed.expected +
      " as persisted, but the file on disk had no self-loop edge at that moment and still does not. " +
      "The app's own bridge agreed with the app; the filesystem did not. That is data loss, not a " +
      "render fault";
  }
  return "the loop is in neither the canvas nor the saved profile - it was never created, or this " +
    "wait ran before any save, in which case a null persistedLoop is expected and says nothing";
}

/** Bounded and self-describing for the same reason as `waitForValue` — see awkit-be5o. */
async function waitForLoop(win, nodeId, present = true, { timeout = 12_000 } = {}) {
  try {
    await win.waitForFunction(({ id, expected }) => Boolean(document.querySelector(
      `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator`
    )) === expected, { id: nodeId, expected: present }, { polling: 100, timeout });
  } catch {
    const state = await readModelVsDom(win, nodeId);

    throw new Error(
      `Loop indicator ${present ? "never appeared" : "never disappeared"} within ${timeout}ms. ` +
        `VERDICT: ${verdictFor(state)}. Actual: ${JSON.stringify(state)}. A selectedWorkflow other than ` +
        `"verify-workflow-loop-capsule", empty domNodes, or onLoginCard=true all mean the fixture did ` +
        `not come back after reload - a never-true condition, not slowness.`
    );
  }
}

/**
 * Same fail-fast-and-explain treatment as `waitForPersistedMaxIterations`, for the DOM side.
 *
 * This is the wait that actually hangs (awkit-be5o): it runs right after `reopenWorkflowFixture()`
 * reloads the window, and if the fixture came back with the wrong workflow selected — or the loop
 * edge did not re-render — the indicator never appears and the default 30s timeout reports only
 * `page.waitForFunction: Timeout 30000ms exceeded`, which says nothing about which of those it was.
 * On expiry we read back the selected workflow, whether the loop edge exists, and the value actually
 * rendered, so the next failure names its own cause.
 */
async function waitForValue(win, nodeId, value, { timeout = 12_000 } = {}) {
  try {
    await win.waitForFunction(({ id, expected }) => (document.querySelector(
      `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-value`
    )?.textContent ?? "").trim() === expected, { id: nodeId, expected: String(value) }, { polling: 100, timeout });
  } catch {
    const state = await readModelVsDom(win, nodeId);
    const renderedValue = await win.evaluate((id) => (document.querySelector(
      `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-value`
    )?.textContent ?? "").trim() || null, nodeId).catch(() => null);

    throw new Error(
      `Loop indicator never showed value ${value} within ${timeout}ms after reload. ` +
        `VERDICT: ${verdictFor(state)}. renderedValue: ${JSON.stringify(renderedValue)}. Actual: ` +
        `${JSON.stringify(state)}. selectedWorkflow other than "verify-workflow-loop-capsule" means ` +
        `reopenWorkflowFixture restored the wrong fixture; a null domLoopEdge means the loop edge did ` +
        `not re-render at all. Neither is slowness, so waiting longer cannot help.`
    );
  }
}

async function fitAndStabilize(win, nodeIds) {
  await win.locator('.canvas-zoom-control button[title="Fit to screen"]').click();
  return Promise.all(nodeIds.map((nodeId) => waitForLoopCapsuleLayoutStable(win, nodeId)));
}

async function collapsePropertiesPanel(win) {
  const collapse = win.locator("#sb-right-panel-collapse");
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
  await win.locator(".scenario-properties-panel").waitFor({ state: "hidden" });
}

async function fitNodeActionIntoView(win, nodeId) {
  await win.locator('.canvas-zoom-control button[title="Fit to screen"]').click();
  await win.waitForFunction((id) => {
    const menu = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(id)}"] .action-node-menu`);
    const canvas = document.querySelector(".awkit-flow-canvas");
    if (!(menu instanceof HTMLButtonElement) || !(canvas instanceof HTMLElement)) return false;
    const rect = menu.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    return rect.left >= canvasRect.left && rect.right <= canvasRect.right &&
      rect.top >= canvasRect.top && rect.bottom <= canvasRect.bottom && Boolean(top && (top === menu || menu.contains(top)));
  }, nodeId);
}

async function panCanvasBy(win, dx, dy) {
  const point = await win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas");
    if (!(canvas instanceof HTMLElement)) return null;
    const rect = canvas.getBoundingClientRect();
    for (let y = rect.top + 32; y <= rect.bottom - 32; y += 32) {
      for (let x = rect.left + 32; x <= rect.right - 32; x += 32) {
        const target = document.elementFromPoint(x, y);
        if (target && canvas.contains(target) &&
          !target.closest("[data-canvas-node]") && !target.closest(".nopan") && !target.closest(".awkit-flow-edge")) {
          return { x, y };
        }
      }
    }
    return null;
  });
  if (!point) return null;
  await win.mouse.move(point.x, point.y);
  await win.mouse.down();
  await win.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
  await win.mouse.up();
  return point;
}

async function reopenWorkflowFixture(win) {
  await win.reload({ waitUntil: "domcontentloaded" });
  await win.waitForSelector(".app-shell, .awkit-login-card", { state: "visible" });
  if (await win.locator("#awkit-login-username").isVisible().catch(() => false)) {
    await win.fill("#awkit-login-username", DEFAULT_CREDS.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(DEFAULT_CREDS.password);
    await win.getByRole("button", { name: "Sign in", exact: true }).click();
    await win.waitForSelector(".app-shell", { state: "visible" });
  }
  await win.setViewportSize({ width: 1440, height: 900 });
  if (!(await win.$(".scenario-flow-node"))) {
    await win.locator('button.nav-item:has(span:text-is("Workflow Builder"))').click().catch(async () => {
      await win.locator('button.nav-item[title="Workflow Builder"]').click();
    });
  }
  await win.locator(WF_SELECT).waitFor({ state: "visible" });
  await win.selectOption(WF_SELECT, "verify-workflow-loop-capsule");
}

/**
 * Wait for a Save to actually reach the persisted workflow, and say what went wrong when it does not.
 *
 * A bare `waitForFunction(... maxIterations === n)` after clicking Save cannot tell "the save is
 * slow" from "the save never happened" — both present as `Timeout 30000ms exceeded`. That
 * indistinguishability is what made this read as a timing flake across several investigations
 * (awkit-be5o): if the Save click is swallowed — a toast or the properties panel intercepting it —
 * the persisted value stays at its previous number FOREVER, and no amount of waiting or faster
 * polling changes that.
 *
 * So the timeout is short, and on expiry the ACTUAL persisted state is read back and reported. A
 * never-true predicate now fails in seconds naming the value it found, instead of burning 30s and
 * looking like flakiness.
 */
async function waitForPersistedMaxIterations(win, expected, { timeout = 10_000 } = {}) {
  try {
    // A bespoke poll rather than `waitForAsyncCondition`, for one reason: the app's failure toast
    // auto-dismisses. Waiting the full timeout and then reading the DOM captured an empty toast list
    // and a status bar reading only "Save failed" - the fact of the failure without its cause. This
    // samples the toast on every poll and keeps the last one seen, so the message that names the
    // error survives long enough to be reported.
    let observedToast = null;
    const deadline = Date.now() + timeout;
    for (;;) {
      const snapshot = await win.evaluate(async (want) => {
        const profile = await window.playwrightFlowStudio.workflows.get("verify-workflow-loop-capsule");
        const persisted = profile?.edges.some(
          (edge) => edge.source === "workflow-node-1" && edge.target === "workflow-node-1" && edge.loop?.maxIterations === want
        ) ?? false;
        return {
          persisted,
          toast: [...document.querySelectorAll(".app-toast")].map((node) => (node.textContent ?? "").trim()).filter(Boolean)
        };
      }, expected);
      if (snapshot.persisted) break;
      if (snapshot.toast.length > 0) observedToast = snapshot.toast;
      if (Date.now() >= deadline) {
        const error = new Error(`persisted maxIterations=${expected} never became true within ${timeout}ms`);
        error.observedToast = observedToast;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Read the FILESYSTEM at the instant the app says the save landed. If these ever disagree, the
    // "persisted" confirmation was a conversation the app had with itself.
    lastPersistObservation = { expected, at: new Date().toISOString(), disk: readDiskWorkflow() };
  } catch (error) {
    // Read every layer the save passes through, because the previous message could only say the
    // save had not landed - not whether the click reached the button, whether the edge still existed
    // to be saved, or whether the app reported an error. Each of those is a different defect.
    const actual = await win.evaluate(async () => {
      const bridge = window.playwrightFlowStudio;
      if (!bridge?.workflows?.get) return { bridge: false };
      const profile = await bridge.workflows.get("verify-workflow-loop-capsule");
      const edge = profile?.edges.find((e) => e.source === "workflow-node-1" && e.target === "workflow-node-1");
      const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save");
      const domLoop = document.querySelector('g.awkit-flow-edge[data-source="workflow-node-1"][data-target="workflow-node-1"]');
      return {
        bridge: true,
        found: Boolean(profile),
        maxIterations: edge?.loop?.maxIterations ?? null,
        persistedEdges: profile?.edges?.map((e) => `${e.source}->${e.target}:${e.type}`) ?? null,
        // Was there still a loop on screen to save at the moment the save was expected?
        domLoopPresent: Boolean(domLoop),
        domLoopValue: (domLoop?.querySelector(".awkit-loop-indicator-value")?.textContent ?? "").trim() || null,
        // Did the click have a button to land on, and is the app claiming anything went wrong?
        saveButtonPresent: Boolean(saveButton),
        saveButtonDisabled: saveButton instanceof HTMLButtonElement ? saveButton.disabled : null,
        // The app renders failures through .app-toast (see components/shared/Toast.tsx). The first
        // version of this read [role=status] and captured the status BAR ("Workflow state" + "Valid"
        // + "Save failed") instead of the message that names the cause.
        toasts: [...document.querySelectorAll(".app-toast")]
          .map((node) => (node.textContent ?? "").trim()).filter(Boolean).slice(0, 5),
        statusText: [...document.querySelectorAll("[role='status'], [role='alert']")]
          .map((node) => (node.textContent ?? "").trim()).filter(Boolean).slice(0, 5),
        propertiesPanelOpen: Boolean(document.querySelector(".scenario-properties-panel"))
      };
    }).catch((readError) => ({ readFailed: String(readError) }));

    throw new Error(
      `Save did not persist maxIterations=${expected} within ${timeout}ms. Actual persisted state: ` +
        `${JSON.stringify(actual)}. Toast seen while waiting: ${JSON.stringify(error?.observedToast ?? null)}. ` +
        `On disk: ${JSON.stringify(readDiskWorkflow())}. Read this in order: ` +
        `domLoopPresent=false means the loop was gone from the canvas BEFORE the save, so nothing was ` +
        `lost - it was never there to save. domLoopPresent=true with a null persisted maxIterations ` +
        `means the app had the loop on screen and did not write it, which is data loss. A non-empty ` +
        `toasts array may name the refusal. saveButtonDisabled=true means the app did not consider ` +
        `there to be anything to save.`
    );
  }
}

async function readPersistedWorkflowLoop(win, nodeId) {
  return win.evaluate(async (sourceId) => {
    const profile = await window.playwrightFlowStudio.workflows.get("verify-workflow-loop-capsule");
    const outgoing = profile?.edges.filter((edge) => edge.source === sourceId) ?? [];
    return {
      loop: outgoing.find((edge) => edge.target === sourceId && edge.type === "loop"),
      exits: outgoing.filter((edge) => edge.target !== sourceId)
    };
  }, nodeId);
}

async function readLoopHistoryStructure(win, nodeId) {
  return win.evaluate((sourceId) => {
    const outgoing = [...document.querySelectorAll(`g.awkit-flow-edge[data-source="${CSS.escape(sourceId)}"]`)];
    const exitIds = outgoing
      .filter((edge) => edge.getAttribute("data-target") !== sourceId)
      .map((edge) => edge.getAttribute("data-id"))
      .filter(Boolean);
    return {
      loops: outgoing.filter((edge) => edge.getAttribute("data-target") === sourceId && edge.getAttribute("data-connector-kind") === "loop").length,
      exits: exitIds.length,
      loopExitControls: exitIds.filter((edgeId) =>
        document.querySelector(`button.awkit-edge-add[data-edge-id="${CSS.escape(edgeId)}"][data-insert-role="loop-exit"]`)
      ).length,
      defaultExitControls: exitIds.filter((edgeId) =>
        document.querySelector(`button.awkit-edge-add[data-edge-id="${CSS.escape(edgeId)}"][data-insert-role="default"]`)
      ).length
    };
  }, nodeId);
}

const hasDottedFourPixelPath = (visual) =>
  visual?.pathStrokeDash?.replace(/px|,/g, " ").trim().split(/\s+/).join(" ") === "1 5" &&
  Number.parseFloat(visual?.pathStrokeWidth) === 4;

export async function runWorkflowLoopCapsuleSuite(root) {
  const results = [];
  const check = (name, pass, detail) => {
    const expectedName = WORKFLOW_LOOP_CAPSULE_CHECK_NAMES[results.length];
    const nameMatches = name === expectedName;
    const passed = Boolean(pass) && nameMatches;
    const resolvedDetail = nameMatches
      ? detail
      : `focused check contract mismatch: expected ${JSON.stringify(expectedName)}, received ${JSON.stringify(name)}${detail ? `; ${detail}` : ""}`;
    results.push({ name, pass: passed, detail: resolvedDetail });
    console.log(`${passed ? "  ✓" : "  ✗"} ${name}${resolvedDetail ? ` — ${resolvedDetail}` : ""}`);
  };
  const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-workflow-loop-capsule-gui");
  activeDataRoot = dataRoot;
  lastPersistObservation = null;
  seedWorkflow(dataRoot);
  const app = await electron.launch({ args: [root, `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`], cwd: root, env });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);
    await win.emulateMedia({ reducedMotion: "no-preference" });
    await win.setViewportSize({ width: 1440, height: 900 });
    if (!(await win.$(".scenario-flow-node"))) {
      await win.locator('button.nav-item:has(span:text-is("Workflow Builder"))').click().catch(async () => {
        await win.locator('button.nav-item[title="Workflow Builder"]').click();
      });
    }
    await win.locator(WF_SELECT).waitFor({ state: "visible" });
    await win.selectOption(WF_SELECT, "verify-workflow-loop-capsule");
    await win.locator('.awkit-flow-node[data-id="workflow-node-1"]').waitFor({ state: "visible" });

    const nodeId = "workflow-node-1";
    await fitNodeActionIntoView(win, nodeId);
    await clickNodeMenuItem(win, nodeId, "Add loop");
    await waitForLoop(win, nodeId);
    const loopMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    const maxIterations = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
    await loopMode.waitFor({ state: "visible" });
    await waitForValue(win, nodeId, 3);
    const initialStable = await fitAndStabilize(win, [nodeId]);
    const initial = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop default renders the approved capsule, dominant ring, configured value, and sweep",
      matchesLoopCapsuleContract(initial, { owner: nodeId, value: 3 }) && initial?.labelText === "Count × 3",
      JSON.stringify(initial)
    );
    check("Workflow Loop capsule oracle rejects the superseded U-route hybrid", rejectsLoopURouteHybrid(initial), JSON.stringify(initial));
    check(
      "Workflow dense-layout scoring chooses the clear side and fit keeps the complete control visible",
      initialStable.every(Boolean) && initial?.side === "right" && initial.ringFullyVisible && initial.controlFullyVisible &&
        !initial.overlapsOtherNode && !initial.overlapsInsertControl,
      JSON.stringify({ initialStable, initial })
    );

    // Move the actual blocking node away and back. The Loop must recompute left, then right, from
    // live peer geometry without detaching or inventing a fixed-side exception.
    await collapsePropertiesPanel(win);
    await fitAndStabilize(win, [nodeId]);
    const blocker = win.locator('.awkit-flow-node[data-id="left-blocker"]');
    const blockerBox = await blocker.boundingBox();
    if (blockerBox) {
      await win.mouse.move(blockerBox.x + blockerBox.width / 2, blockerBox.y + blockerBox.height / 2);
      await win.mouse.down();
      await win.mouse.move(blockerBox.x + blockerBox.width / 2, blockerBox.y + blockerBox.height / 2 + 180, { steps: 8 });
      await win.mouse.up();
    }
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const peerMovedAway = await readLoopCapsuleVisual(win, nodeId);
    const movedBlockerBox = await blocker.boundingBox();
    if (movedBlockerBox) {
      await win.mouse.move(movedBlockerBox.x + movedBlockerBox.width / 2, movedBlockerBox.y + movedBlockerBox.height / 2);
      await win.mouse.down();
      await win.mouse.move(movedBlockerBox.x + movedBlockerBox.width / 2, movedBlockerBox.y + movedBlockerBox.height / 2 - 180, { steps: 8 });
      await win.mouse.up();
    }
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const peerRestored = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop recomputes its clear side when a neighboring node moves away and back",
      Boolean(blockerBox && movedBlockerBox) && peerMovedAway?.side === "left" && peerRestored?.side === "right" &&
        matchesLoopCapsuleContract(peerMovedAway, { owner: nodeId, value: 3 }) && matchesLoopCapsuleContract(peerRestored, { owner: nodeId, value: 3 }),
      JSON.stringify({ peerMovedAway, peerRestored })
    );
    const initialHit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await initialHit.click();
    await loopMode.waitFor({ state: "visible" });

    await loopMode.selectOption("whileCondition");
    await maxIterations.fill("10");
    await win.locator('.scenario-properties-panel label:has-text("Line style") select').selectOption("dotted");
    await win.locator('.scenario-properties-panel label:has-text("Thickness") select').selectOption("4");
    await win.locator('.scenario-properties-panel label:has-text("Connector shape") select').selectOption("smoothstep");
    await waitForValue(win, nodeId, 10);
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const visual = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop keeps mode-aware design text while the ring displays maxIterations",
      matchesLoopCapsuleContract(visual, { owner: nodeId, value: 10 }) && visual?.labelText === "While · status = passed" &&
        hasDottedFourPixelPath(visual) && !/\b\d+\s*\/\s*\d+\b|\biteration\b/i.test(visual?.ariaLabel ?? ""),
      JSON.stringify(visual)
    );
    check(
      "Workflow Loop uses same-side capsule attachment and never the full-node U-route",
      visual?.sameSideAttachment && visual.laneAttachedToNode && visual.capsulePathIsCompact && !visual.pathWrapsWholeNode &&
        visual.markerOutsideNode && visual.directionCount === 0 && visual.arrowCount === 0,
      JSON.stringify(visual)
    );

    const motion = await readLoopCapsuleMotion(win, nodeId);
    const pixelMotion = await readLoopCapsulePixelMotion(win, nodeId);
    check(
      "Workflow Loop rotates only the circular sweep without moving value, label, or capsule geometry",
      visual?.animationName === "awkit-loop-control-orbit" && visual.animationIterationCount === "infinite" &&
        visual.animationTimingFunction === "linear" && Number.parseFloat(visual.animationDuration) === 2 && visual.sweepAnimationCount === 1 &&
        motion?.moved && Number.isFinite(motion.delta) && motion.delta >= 100 && !motion.valueMoved && !motion.labelMoved &&
        motion.valueAnimationCount === 0 && motion.labelAnimationCount === 0 &&
        Number.isFinite(pixelMotion?.changedPixels) && pixelMotion.changedPixels >= 12 && pixelMotion.totalDelta > 0,
      JSON.stringify({ visual, motion, pixelMotion })
    );

    await win.emulateMedia({ reducedMotion: "reduce" });
    await win.waitForFunction((id) => {
      const sweep = document.querySelector(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-sweep`);
      return sweep instanceof SVGCircleElement && getComputedStyle(sweep).animationName === "none";
    }, nodeId);
    const reduced = await readLoopCapsuleVisual(win, nodeId);
    const reducedMotion = await readLoopCapsuleMotion(win, nodeId);
    check(
      "Workflow Loop reduced motion freezes only the sweep and leaves capsule/value readable",
      matchesLoopCapsuleContract(reduced, { owner: nodeId, value: 10 }) && reduced?.animationName === "none" &&
        reduced.animationTransform !== "none" && reduced.valueDisplay !== "none" && Number.parseFloat(reduced.valueOpacity) > 0 &&
        !reducedMotion?.moved && !reducedMotion?.valueMoved && !reducedMotion?.labelMoved,
      JSON.stringify({ reduced, reducedMotion })
    );
    await win.emulateMedia({ reducedMotion: "no-preference" });

    const resetZoom = win.locator('.canvas-zoom-control button[title="Reset to 100%"]');
    const zoomOut = win.locator('.canvas-zoom-control button[title="Zoom out"]');
    const zoomIn = win.locator('.canvas-zoom-control button[title="Zoom in"]');
    const zoomValue = win.locator(".canvas-zoom-control .zoom-value");
    const sampleZoom = async () => {
      const stable = await waitForLoopCapsuleLayoutStable(win, nodeId);
      return { percent: Number.parseInt((await zoomValue.textContent()) ?? "", 10), stable, visual: await readLoopCapsuleVisual(win, nodeId) };
    };
    await resetZoom.click();
    for (let index = 0; index < 8; index += 1) await zoomOut.click();
    const at25 = await sampleZoom();
    await resetZoom.click();
    const at100 = await sampleZoom();
    for (let index = 0; index < 10; index += 1) await zoomIn.click();
    const at200 = await sampleZoom();
    await resetZoom.click();
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const beforePan = await readLoopCapsuleVisual(win, nodeId);
    const panPoint = await panCanvasBy(win, 48, 24);
    const panStable = await waitForLoopCapsuleLayoutStable(win, nodeId);
    const afterPan = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop capsule remains attached and structurally identical through zoom and viewport pan",
      at25.percent === 25 && at100.percent === 100 && at200.percent === 200 &&
        [at25, at100, at200].every((sample) => sample.stable && matchesLoopCapsuleContract(sample.visual, { owner: nodeId, value: 10 }) &&
          sample.visual.laneAttachedToNode && sample.visual.sameSideAttachment && !sample.visual.pathWrapsWholeNode) &&
        Boolean(panPoint) && panStable && loopCapsuleMovedWithNode(beforePan, afterPan) &&
        Math.abs((afterPan?.nodeLeft ?? 0) - (beforePan?.nodeLeft ?? 0) - 48) <= 2 &&
        Math.abs((afterPan?.nodeTop ?? 0) - (beforePan?.nodeTop ?? 0) - 24) <= 2 &&
        beforePan?.pathData === afterPan?.pathData && beforePan?.sweepAnimationStartTime === afterPan?.sweepAnimationStartTime &&
        matchesLoopCapsuleContract(afterPan, { owner: nodeId, value: 10 }),
      JSON.stringify({ at25, at100, at200, panPoint, panStable, beforePan, afterPan })
    );

    await fitAndStabilize(win, [nodeId]);
    const beforeDrag = await readLoopCapsuleVisual(win, nodeId);
    const box = await win.locator(`.awkit-flow-node[data-id="${nodeId}"]`).boundingBox();
    if (box) {
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2 - 36, box.y + box.height / 2 + 20, { steps: 6 });
      await win.mouse.up();
    }
    const dragStable = await waitForLoopCapsuleLayoutStable(win, nodeId);
    const afterDrag = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Dragging the Workflow node preserves capsule attachment, ring/value ownership, and geometry",
      Boolean(box) && dragStable && beforeDrag?.side === "right" && afterDrag?.side === "right" &&
        loopCapsuleMovedWithNode(beforeDrag, afterDrag) && matchesLoopCapsuleContract(afterDrag, { owner: nodeId, value: 10 }),
      JSON.stringify({ dragStable, beforeDrag, afterDrag })
    );

    const secondId = "workflow-node-2";
    await collapsePropertiesPanel(win);
    await fitAndStabilize(win, [nodeId]);
    const primaryBeforeSecond = await readLoopCapsuleVisual(win, nodeId);
    await clickNodeMenuItem(win, secondId, "Add loop");
    await waitForLoop(win, secondId);
    await maxIterations.fill("7");
    await waitForValue(win, secondId, 7);
    const peersStable = await Promise.all([
      waitForLoopCapsuleLayoutStable(win, nodeId),
      waitForLoopCapsuleLayoutStable(win, secondId)
    ]);
    const firstWithPeer = await readLoopCapsuleVisual(win, nodeId);
    const second = await readLoopCapsuleVisual(win, secondId);
    const peerMotion = await Promise.all([
      readLoopCapsuleMotion(win, nodeId),
      readLoopCapsuleMotion(win, secondId)
    ]);
    check(
      "Two Workflow Loops keep independent identities, authored state, selection, and moving sweeps",
      peersStable.every(Boolean) && firstWithPeer?.edgeId !== second?.edgeId && matchesLoopCapsuleContract(firstWithPeer, { owner: nodeId, value: 10 }) &&
        matchesLoopCapsuleContract(second, { owner: secondId, value: 7 }) && firstWithPeer?.labelText === "While · status = passed" && second?.labelText === "Count × 7" &&
        firstWithPeer.selected === false && second.selected === true &&
        firstWithPeer.duplicateLoopDomIdCount === 0 && second.duplicateLoopDomIdCount === 0 &&
        firstWithPeer.sweepAnimationStartTime === primaryBeforeSecond?.sweepAnimationStartTime &&
        Number.isFinite(second.sweepAnimationStartTime) && second.sweepAnimationStartTime !== firstWithPeer.sweepAnimationStartTime &&
        peerMotion.every((item) => item?.moved && Number.isFinite(item.delta) && item.delta >= 100 &&
          !item.valueMoved && !item.labelMoved && item.valueAnimationCount === 0 && item.labelAnimationCount === 0),
      JSON.stringify({ firstWithPeer, second, peerMotion })
    );

    await win.emulateMedia({ reducedMotion: "reduce" });
    const reducedPeerMotion = await Promise.all([
      readLoopCapsuleMotion(win, nodeId),
      readLoopCapsuleMotion(win, secondId)
    ]);
    const reducedPeers = await Promise.all([
      readLoopCapsuleVisual(win, nodeId),
      readLoopCapsuleVisual(win, secondId)
    ]);
    check(
      "Reduced motion freezes both independent Workflow sweeps without hiding either value or label",
      reducedPeers.every((item, index) => matchesLoopCapsuleContract(item, { owner: index === 0 ? nodeId : secondId, value: index === 0 ? 10 : 7 }) &&
        item.animationName === "none" && item.valueDisplay !== "none" && item.labelDisplay !== "none") &&
        reducedPeerMotion.every((item) => item && !item.moved && !item.valueMoved && !item.labelMoved),
      JSON.stringify({ reducedPeers, reducedPeerMotion })
    );
    await win.emulateMedia({ reducedMotion: "no-preference" });

    if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE || process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK) {
      await collapsePropertiesPanel(win);
      await fitAndStabilize(win, [nodeId, secondId]);
    }
    if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE) {
      await win.screenshot({ path: process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE });
    }
    if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK) {
      const evidenceTheme = await win.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "light");
      await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await waitForLoopCapsuleLayoutStable(win, nodeId);
      await win.screenshot({ path: process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK });
      await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), evidenceTheme);
    }
    await collapsePropertiesPanel(win);
    await fitAndStabilize(win, [nodeId, secondId]);
    await clickNodeMenuItem(win, secondId, "Remove loop");
    await waitForLoop(win, secondId, false);

    await clickNodeMenuItem(win, nodeId, "Configure loop");
    await maxIterations.fill("12");
    await waitForValue(win, nodeId, 12);
    await win.getByRole("button", { name: "Save", exact: true }).click();
    // `polling: 100` is deliberate, not an arbitrary sleep. waitForFunction defaults to polling on
    // requestAnimationFrame, which only ticks while the window composites — but this predicate asks
    // about PERSISTED state reached through an async IPC round-trip, not about anything painted.
    // With a non-compositing window it is never re-evaluated and times out at 30s despite the save
    // having landed. That is awkit-r9f3, captured on the Flow suite at the identically-named
    // "save preserves Loop configuration" check. The assertion itself is unchanged.
    await waitForPersistedMaxIterations(win, 12);
    const persisted = await readPersistedWorkflowLoop(win, nodeId);
    check(
      "Workflow save preserves Loop configuration, authored style, and exactly one promoted Conditional exit",
      persisted.loop?.loop?.mode === "whileCondition" && persisted.loop?.loop?.maxIterations === 12 &&
        persisted.loop?.style?.lineStyle === "dotted" && persisted.loop?.style?.thickness === 4 && persisted.loop?.style?.shape === "smoothstep" &&
        persisted.exits.length === 1 && persisted.exits[0]?.type === "conditional" && persisted.exits[0]?.condition?.expression === "true",
      JSON.stringify(persisted)
    );

    await reopenWorkflowFixture(win);
    await waitForLoop(win, nodeId);
    await waitForValue(win, nodeId, 12);
    const reloaded = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow reload preserves the capsule contract, rendered style, and exact configured value",
      matchesLoopCapsuleContract(reloaded, { owner: nodeId, value: 12 }) && reloaded?.labelText === "While · status = passed" &&
        hasDottedFourPixelPath(reloaded),
      JSON.stringify(reloaded)
    );

    const reloadedLoopMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    const reloadedMaxIterations = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
    const reloadedLineStyle = win.locator('.scenario-properties-panel label:has-text("Line style") select');
    const reloadedThickness = win.locator('.scenario-properties-panel label:has-text("Thickness") select');
    const reloadedShape = win.locator('.scenario-properties-panel label:has-text("Connector shape") select');
    let hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await reloadedLoopMode.waitFor({ state: "visible" });
    const firstEditorExact = await reloadedLoopMode.inputValue() === "whileCondition" && await reloadedMaxIterations.inputValue() === "12" &&
      await reloadedLineStyle.inputValue() === "dotted" && await reloadedThickness.inputValue() === "4" && await reloadedShape.inputValue() === "smoothstep";
    await reloadedMaxIterations.fill("13");
    await waitForValue(win, nodeId, 13);
    await win.locator("#sb-undo").click();
    await waitForValue(win, nodeId, 12);
    if (!(await reloadedMaxIterations.isVisible().catch(() => false))) {
      hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
      await hit.click();
      await reloadedMaxIterations.waitFor({ state: "visible" });
    }
    const configurationUndoExact = await reloadedMaxIterations.inputValue() === "12";
    await win.locator("#sb-redo").click();
    await waitForValue(win, nodeId, 13);
    if (!(await reloadedMaxIterations.isVisible().catch(() => false))) {
      hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
      await hit.click();
      await reloadedMaxIterations.waitFor({ state: "visible" });
    }
    const configurationRedoExact = await reloadedMaxIterations.inputValue() === "13";
    await win.getByRole("button", { name: "Save", exact: true }).click();
    await waitForPersistedMaxIterations(win, 13);
    const secondPersisted = await readPersistedWorkflowLoop(win, nodeId);

    await reopenWorkflowFixture(win);
    await waitForLoop(win, nodeId);
    await waitForValue(win, nodeId, 13);
    const secondReloaded = await readLoopCapsuleVisual(win, nodeId);
    hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await reloadedLoopMode.waitFor({ state: "visible" });
    const secondEditorExact = await reloadedLoopMode.inputValue() === "whileCondition" && await reloadedMaxIterations.inputValue() === "13" &&
      await reloadedLineStyle.inputValue() === "dotted" && await reloadedThickness.inputValue() === "4" && await reloadedShape.inputValue() === "smoothstep";
    check(
      "Workflow dominant ring supports exact config Undo/Redo and a second persisted edit/reload cycle",
      firstEditorExact && configurationUndoExact && configurationRedoExact && secondEditorExact &&
        matchesLoopCapsuleContract(secondReloaded, { owner: nodeId, value: 13 }) && hasDottedFourPixelPath(secondReloaded) &&
        secondPersisted.loop?.loop?.mode === "whileCondition" && secondPersisted.loop?.loop?.maxIterations === 13 &&
        secondPersisted.loop?.style?.lineStyle === "dotted" && secondPersisted.loop?.style?.thickness === 4 && secondPersisted.loop?.style?.shape === "smoothstep" &&
        secondPersisted.exits.length === 1 && secondPersisted.exits[0]?.type === "conditional" && secondPersisted.exits[0]?.condition?.expression === "true",
      JSON.stringify({ firstEditorExact, configurationUndoExact, configurationRedoExact, secondEditorExact, secondPersisted, secondReloaded })
    );

    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    let group = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
    await group.focus();
    await win.keyboard.press("Enter");
    await reloadedLoopMode.waitFor({ state: "visible" });
    const enterAccessible = (await group.getAttribute("aria-label"))?.includes("While · status = passed");
    await collapsePropertiesPanel(win);
    await group.focus();
    await win.keyboard.press("Space");
    await reloadedLoopMode.waitFor({ state: "visible" });
    const spaceAccessible = await reloadedLoopMode.inputValue() === "whileCondition";
    await collapsePropertiesPanel(win);
    await hit.dblclick();
    await reloadedLoopMode.waitFor({ state: "visible" });
    const doubleClickAccessible = await reloadedLoopMode.inputValue() === "whileCondition";

    await collapsePropertiesPanel(win);
    await group.focus();
    await group.press("Delete");
    await waitForLoop(win, nodeId, false);
    const deletedStructure = await readLoopHistoryStructure(win, nodeId);
    await win.locator("#sb-undo").click();
    await waitForLoop(win, nodeId);
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const undoneVisual = await readLoopCapsuleVisual(win, nodeId);
    const undoneStructure = await readLoopHistoryStructure(win, nodeId);
    hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await reloadedLoopMode.waitFor({ state: "visible" });
    const undoneEditorExact = await reloadedLoopMode.inputValue() === "whileCondition" && await reloadedMaxIterations.inputValue() === "13" &&
      await reloadedLineStyle.inputValue() === "dotted" && await reloadedThickness.inputValue() === "4" && await reloadedShape.inputValue() === "smoothstep";
    await collapsePropertiesPanel(win);
    await win.locator("#sb-redo").click();
    await waitForLoop(win, nodeId, false);
    const redoneStructure = await readLoopHistoryStructure(win, nodeId);
    await win.locator("#sb-undo").click();
    await waitForLoop(win, nodeId);
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const restoredVisual = await readLoopCapsuleVisual(win, nodeId);
    const restoredStructure = await readLoopHistoryStructure(win, nodeId);
    group = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
    hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await reloadedLoopMode.waitFor({ state: "visible" });
    const restoredEditorExact = await reloadedLoopMode.inputValue() === "whileCondition" && await reloadedMaxIterations.inputValue() === "13" &&
      await reloadedLineStyle.inputValue() === "dotted" && await reloadedThickness.inputValue() === "4" && await reloadedShape.inputValue() === "smoothstep";
    check(
      "Workflow Loop stays accessible and Delete/Undo/Redo restores its exact authored state once",
      enterAccessible && spaceAccessible && doubleClickAccessible && undoneEditorExact && restoredEditorExact &&
        deletedStructure.loops === 0 && deletedStructure.exits === 1 && deletedStructure.loopExitControls === 0 && deletedStructure.defaultExitControls === 1 &&
        matchesLoopCapsuleContract(undoneVisual, { owner: nodeId, value: 13 }) && undoneStructure.loops === 1 && undoneStructure.exits === 1 &&
        undoneStructure.loopExitControls === 1 && undoneStructure.defaultExitControls === 0 &&
        redoneStructure.loops === 0 && redoneStructure.exits === 1 && redoneStructure.loopExitControls === 0 && redoneStructure.defaultExitControls === 1 &&
        matchesLoopCapsuleContract(restoredVisual, { owner: nodeId, value: 13 }) && restoredStructure.loops === 1 && restoredStructure.exits === 1 &&
        restoredStructure.loopExitControls === 1 && restoredStructure.defaultExitControls === 0,
      JSON.stringify({ enterAccessible, spaceAccessible, doubleClickAccessible, deletedStructure, undoneEditorExact, undoneVisual, undoneStructure, redoneStructure, restoredEditorExact, restoredVisual, restoredStructure })
    );

    /* Unsaved bound edit survives reopening the editor (awkit-3ve).
       The retired walkthrough asserted this against the U-route summary, so it was allowlisted and
       nothing replaced it — and unlike the Flow suite, which covers `unsaved`, the Workflow suite
       had no equivalent at all. The behaviour under test is the two-way binding: editing Max
       iterations updates the connector immediately, so closing the panel and reopening it must show
       the edited value rather than reverting to the last SAVED one. A revert here would silently
       discard a user's in-progress edit. */
    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await clickNodeMenuItem(win, nodeId, "Configure loop");
    const unsavedMax = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
    await unsavedMax.waitFor({ state: "visible" });
    await unsavedMax.fill("21");
    await unsavedMax.blur();

    const loopGroupForUnsaved = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
    // The ring renders maxIterations, so the unsaved edit must be visible on the canvas immediately.
    await win.waitForFunction(
      (id) => {
        const group = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
        return group?.textContent?.includes("21") === true;
      },
      nodeId,
      { timeout: 5_000 }
    ).catch(() => undefined);
    const ringShowsUnsaved = (await loopGroupForUnsaved.textContent())?.includes("21") === true;
    const summaryWhileUnsaved = (await loopGroupForUnsaved.getAttribute("aria-label")) ?? "";

    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await clickNodeMenuItem(win, nodeId, "Configure loop");
    const reopenedMax = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
    const reopenedMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    await reopenedMax.waitFor({ state: "visible" });
    const reopenedValue = await reopenedMax.inputValue();
    const reopenedModeValue = await reopenedMode.inputValue();
    const summaryAfterReopen = (await loopGroupForUnsaved.getAttribute("aria-label")) ?? "";

    check(
      "Configure loop reopens the Workflow Loop with its unsaved bound edit and authored summary intact",
      ringShowsUnsaved &&
        reopenedValue === "21" &&
        reopenedModeValue === "whileCondition" &&
        summaryWhileUnsaved.includes("While · status = passed") &&
        summaryAfterReopen.includes("While · status = passed"),
      JSON.stringify({ ringShowsUnsaved, reopenedValue, reopenedModeValue, summaryWhileUnsaved, summaryAfterReopen })
    );

    await app.close();
    cleanup();
    const checkContractMatches = matchesWorkflowLoopCapsuleCheckContract(results);
    if (!checkContractMatches) {
      console.error(`Focused Workflow Loop check contract failed: observed ${results.length}/${WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length} exact named checks.`);
    }
    return { pass: checkContractMatches && results.every((result) => result.pass), results, checkContractMatches };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    console.error("Focused Workflow Loop capsule verifier failed:", error);
    return { pass: false, results, error: error instanceof Error ? error.message : String(error) };
  }
}
