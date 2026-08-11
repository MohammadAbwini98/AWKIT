// Real GUI walkthrough of the Workflow Builder canvas (the Flow Designer counterpart lives in
// scripts/verify-flow-designer-gui.mjs). Launches the actual built Electron app via Playwright's
// _electron and drives the Workflow Builder (ScenarioBuilder), asserting on the real rendered
// DOM/SVG. The canvas runs on the in-house engine (app/renderer/components/canvas) — no React
// Flow — rendering `.awkit-flow-node[data-id]` cards (wrapping `.scenario-flow-node`) and
// `g.awkit-flow-edge` connectors. The kebab menu toggles a node's self-loop connector.
//
// Runs against an ISOLATED, empty %LOCALAPPDATA% and signs in past the SecurityGate first-run
// (PR #15 gates every route until authenticated), then seeds two flows + one workflow so the builder
// auto-opens a workflow with a cross-node edge and the picker's "Saved Flows" section is populated.
// See bd awkit-gmn.
//
// Run: node scripts/verify-workflow-builder-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-workflow-builder-gui");
seedWorkflowFixture(dataRoot);

// Seed two saved flows and one workflow (flowA → flowB) so the builder auto-loads a workflow with a
// connector + a loopable flowRef node, and the contextual picker's "Saved Flows" section has entries.
function seedWorkflowFixture(localAppData) {
  const now = new Date().toISOString();
  const specter = path.join(localAppData, "SpecterStudio");
  const flowsDir = path.join(specter, "flows");
  const workflowsDir = path.join(specter, "workflows");
  mkdirSync(flowsDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });
  const mkFlow = (id, name) => ({
    id,
    name,
    description: "Workflow Builder GUI verifier fixture flow.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "goto", type: "goto", name: "Open Page", url: "http://localhost:4321/login", valueSource: { type: "static", value: "http://localhost:4321/login" } },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "end", type: "success" }
    ]
  });
  const mkRef = (flowId, order) => ({
    id: flowId,
    type: "flowRef",
    flowId,
    alias: flowId,
    order,
    required: true,
    inputBindings: {},
    retryPolicy: { count: 0, delayMs: 0 },
    failurePolicy: "stop",
    position: { x: 140 + (order - 1) * 320, y: 180 }
  });
  for (const [id, name] of [["verify-flow-a", "Verify — Flow A"], ["verify-flow-b", "Verify — Flow B"]]) {
    writeFileSync(path.join(flowsDir, `${id}.json`), `${JSON.stringify(mkFlow(id, name), null, 2)}\n`, "utf8");
  }
  const workflow = {
    id: "verify-workflow",
    name: "Verify — Workflow",
    description: "Two-flow workflow with a cross-node connector for the Workflow Builder verifier.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [mkRef("verify-flow-a", 1), mkRef("verify-flow-b", 2)],
    edges: [{ id: "w0", source: "verify-flow-a", target: "verify-flow-b", type: "success" }],
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
  };
  writeFileSync(path.join(workflowsDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  const loopAuthoringWorkflow = {
    ...workflow,
    id: "verify-workflow-loop-authoring",
    name: "Verify — Loop Authoring",
    description: "Untouched workflow with distinct node/flow ids and a Standard exit for loop-authoring verification.",
    nodes: workflow.nodes.map((node, index) => ({ ...node, id: `workflow-node-${index + 1}` })),
    // A custom label proves loop-exit treatment is structural and never depends on "Exit loop" text.
    edges: [{ id: "w-loop-authoring", source: "workflow-node-1", target: "workflow-node-2", type: "success", label: "always" }]
  };
  writeFileSync(path.join(workflowsDir, `${loopAuthoringWorkflow.id}.json`), `${JSON.stringify(loopAuthoringWorkflow, null, 2)}\n`, "utf8");
}

function importFixture(name, flowIds) {
  return {
    id: "verify-workflow",
    name,
    description: "Workflow Builder import verifier fixture.",
    version: 1,
    nodes: flowIds.map((flowId, index) => ({
      id: flowId,
      type: "flowRef",
      flowId,
      alias: flowId,
      order: index + 1,
      required: true,
      inputBindings: {},
      position: { x: 160 + index * 320, y: 180 }
    })),
    edges: flowIds.slice(1).map((flowId, index) => ({
      id: `import-edge-${index}`,
      source: flowIds[index],
      target: flowId,
      type: "success"
    })),
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
  };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Open the scenario node's portaled kebab menu and choose one exact action.
async function clickNodeMenuItem(win, nodeId, label) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  await win.evaluate((expected) => {
    const item = [...document.querySelectorAll(".node-options-menu .node-options-item")]
      .find((button) => (button.textContent || "").trim().toLowerCase() === expected.toLowerCase());
    if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, label);
  await win.waitForTimeout(150);
}

// Read every Loop-specific action without activating one.
async function loopMenuLabels(win, nodeId) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  const labels = await win.evaluate(
    () => [...document.querySelectorAll(".node-options-menu .node-options-item")]
      .map((button) => (button.textContent || "").trim())
      .filter((label) => /loop/i.test(label))
  );
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(80);
  return labels;
}

async function readLoopVisual(win, nodeId) {
  return win.evaluate((id) => {
    const group = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
    const node = document.querySelector(`.awkit-flow-node[data-id="${id}"]`);
    const base = group?.querySelector(".awkit-flow-edge-path");
    const direction = group?.querySelector(".awkit-loop-direction-path");
    if (!(group instanceof SVGGElement) || !(node instanceof HTMLElement) || !(base instanceof SVGPathElement) || !(direction instanceof SVGPathElement)) return null;
    const baseStyle = getComputedStyle(base);
    const directionStyle = getComputedStyle(direction);
    const keyframes = direction.getAnimations()[0]?.effect?.getKeyframes?.() ?? [];
    const nodeRect = node.getBoundingClientRect();
    const pathRect = base.getBoundingClientRect();
    return {
      className: group.getAttribute("class") || "",
      connectorKind: group.getAttribute("data-connector-kind"),
      baseCount: group.querySelectorAll(".awkit-flow-edge-path").length,
      directionCount: group.querySelectorAll(".awkit-loop-direction-path").length,
      samePath: base.getAttribute("d") === direction.getAttribute("d"),
      baseDash: base.style.strokeDasharray || baseStyle.strokeDasharray,
      baseWidth: baseStyle.strokeWidth,
      directionDash: directionStyle.strokeDasharray,
      directionWidth: directionStyle.strokeWidth,
      animationName: directionStyle.animationName,
      animationIterationCount: directionStyle.animationIterationCount,
      animationTimingFunction: directionStyle.animationTimingFunction,
      display: directionStyle.display,
      terminalOffset: String(keyframes.at(-1)?.strokeDashoffset ?? ""),
      pathLeft: pathRect.left,
      pathRight: pathRect.right,
      nodeLeft: nodeRect.left,
      nodeRight: nodeRect.right
    };
  }, nodeId);
}


async function readLoopExitControlVisual(win, nodeId) {
  return win.evaluate((id) => {
    const edgeGroups = [...document.querySelectorAll("g.awkit-flow-edge")];
    const exitGroup = edgeGroups.find(
      (edge) => edge.getAttribute("data-source") === id && edge.getAttribute("data-target") !== id
    );
    const selfGroup = edgeGroups.find(
      (edge) => edge.getAttribute("data-source") === id && edge.getAttribute("data-target") === id
    );
    const edgeId = exitGroup?.getAttribute("data-id") ?? "";
    const selfEdgeId = selfGroup?.getAttribute("data-id") ?? "";
    const controls = [...document.querySelectorAll("button.awkit-edge-add")];
    const control = controls.find((button) => button.getAttribute("data-edge-id") === edgeId);
    const label = [...document.querySelectorAll(".awkit-edge-label")]
      .find((element) => element.getAttribute("data-edge-id") === edgeId);
    const path = exitGroup?.querySelector(".awkit-flow-edge-path");
    if (!(control instanceof HTMLButtonElement) || !(label instanceof HTMLElement) || !(path instanceof SVGPathElement)) return null;

    const sourceNode = [...document.querySelectorAll(".awkit-flow-node[data-id]")]
      .find((node) => node.getAttribute("data-id") === id);
    const targetId = exitGroup?.getAttribute("data-target");
    const targetNode = [...document.querySelectorAll(".awkit-flow-node[data-id]")]
      .find((node) => node.getAttribute("data-id") === targetId);
    const icon = control.querySelector(".awkit-edge-add-icon");
    const genericControl = controls.find((button) => button.getAttribute("data-insert-role") === "default");
    const genericIcon = genericControl?.querySelector(".awkit-edge-add-icon");
    const controlRect = control.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const sourceRect = sourceNode?.getBoundingClientRect();
    const targetRect = targetNode?.getBoundingClientRect();
    const center = { x: controlRect.left + controlRect.width / 2, y: controlRect.top + controlRect.height / 2 };
    const matrix = path.getScreenCTM();
    let pathDistance = Number.POSITIVE_INFINITY;
    if (matrix) {
      const length = path.getTotalLength();
      for (let index = 0; index <= 160; index += 1) {
        const point = path.getPointAtLength((length * index) / 160);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        pathDistance = Math.min(pathDistance, Math.hypot(screen.x - center.x, screen.y - center.y));
      }
    }
    const overlaps = (a, b) => Boolean(
      a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    );
    const overlapsOtherControl = controls.some((button) => {
      if (button === control) return false;
      return overlaps(controlRect, button.getBoundingClientRect());
    });
    const style = getComputedStyle(control);
    const iconStyle = icon instanceof SVGElement ? getComputedStyle(icon) : null;
    const genericStyle = genericControl instanceof HTMLButtonElement ? getComputedStyle(genericControl) : null;
    const genericIconStyle = genericIcon instanceof SVGElement ? getComputedStyle(genericIcon) : null;
    const haloStyle = getComputedStyle(control, "::after");
    const haloAnimation = document.getAnimations().find((animation) => animation.animationName === "awkit-loop-exit-halo");
    const animatedHaloScales = (haloAnimation?.effect?.getKeyframes?.() ?? []).map((frame) => {
      const match = /^scale\(([\d.]+)\)$/.exec(String(frame.transform ?? ""));
      return match ? Number.parseFloat(match[1]) : 1;
    });
    const computedHaloScale = haloStyle.transform === "none" ? 1 : new DOMMatrix(haloStyle.transform).a;
    const haloScale = Math.max(1, computedHaloScale, ...animatedHaloScales);
    const haloOverflow = (controlRect.width * (haloScale - 1)) / 2;
    const haloRect = {
      left: controlRect.left - haloOverflow,
      right: controlRect.right + haloOverflow,
      top: controlRect.top - haloOverflow,
      bottom: controlRect.bottom + haloOverflow
    };

    return {
      edgeId,
      role: control.getAttribute("data-insert-role"),
      className: control.className,
      ariaLabel: control.getAttribute("aria-label"),
      width: style.width,
      height: style.height,
      iconWidth: iconStyle?.width ?? "",
      genericWidth: genericStyle?.width ?? "",
      genericIconWidth: genericIconStyle?.width ?? "",
      labelText: (label.textContent ?? "").trim(),
      labelRole: label.getAttribute("data-insert-role"),
      labelClearance: labelRect.top >= controlRect.bottom
        ? labelRect.top - controlRect.bottom
        : controlRect.top - labelRect.bottom,
      pathDistance,
      overlapsLabel: overlaps(controlRect, labelRect),
      overlapsSource: overlaps(controlRect, sourceRect),
      overlapsTarget: overlaps(controlRect, targetRect),
      overlapsOtherControl,
      haloScale,
      haloOverlapsLabel: overlaps(haloRect, labelRect),
      haloOverlapsSource: overlaps(haloRect, sourceRect),
      haloOverlapsTarget: overlaps(haloRect, targetRect),
      haloOverlapsOtherControl: controls.some((button) => button !== control && overlaps(haloRect, button.getBoundingClientRect())),
      selfHasControl: controls.some((button) => button.getAttribute("data-edge-id") === selfEdgeId),
      haloAnimationName: haloStyle.animationName,
      haloDuration: haloStyle.animationDuration,
      haloIterationCount: haloStyle.animationIterationCount,
      haloTimingFunction: haloStyle.animationTimingFunction,
      haloOpacity: haloStyle.opacity,
      haloTransform: haloStyle.transform,
      haloContent: haloStyle.content
    };
  }, nodeId);
}

const WF_SELECT = 'label.sb-toolbar-field:has(span:text-is("Workflow")) select';
const WF_NAME_INPUT = 'label.sb-toolbar-field:has(span:text-is("Workflow name")) input';
const IMPORT_INPUT = '.sb-toolbar-group[aria-label="Files"] input[type="file"]';

async function setImportFile(win, value, fileName = "workflow.json") {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  await win.locator(IMPORT_INPUT).setInputFiles({
    name: fileName,
    mimeType: "application/json",
    buffer: Buffer.from(body, "utf8")
  });
}

async function importState(win) {
  return win.evaluate(async () => {
    const stored = await window.playwrightFlowStudio.workflows.get("verify-workflow");
    const nodes = [...document.querySelectorAll(".awkit-flow-node[data-id]")]
      .map((node) => node.getAttribute("data-id"))
      .filter(Boolean)
      .sort();
    const edges = [...document.querySelectorAll("g.awkit-flow-edge")]
      .map((edge) => `${edge.getAttribute("data-source")}->${edge.getAttribute("data-target")}`)
      .sort();
    const selected = document.querySelector(".scenario-flow-node.selected")?.closest(".awkit-flow-node")?.getAttribute("data-id") ?? null;
    const saveState = (document.querySelector(".sb-save-state")?.textContent ?? "").trim();
    return { stored, nodes, edges, selected, saveState };
  });
}

function sameImportState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await resolveMainWindow(app);
  const consoleErrors = [];
  win.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForTimeout(1200);

  // The sibling Workflows library should use the full editor surface before entering the Builder.
  await win.click('button.nav-item:has(span:text-is("Workflows"))').catch(() => {});
  await win.getByTestId("workflows-library-surface").waitFor({ state: "visible", timeout: 10000 });
  const workflowsLayout = await win.evaluate(() => {
    const page = document.querySelector(".workflows-library-page");
    const panel = document.querySelector(".workflows-library-panel");
    const table = document.querySelector(".wl-table-workflows");
    if (!page || !panel || !table) return null;
    const pageRect = page.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      pageWidth: pageRect.width,
      panelWidth: panelRect.width,
      tableWidth: table.getBoundingClientRect().width,
      wrapperWidth: table.parentElement?.getBoundingClientRect().width ?? 0,
      panelFillsPage: Math.abs(pageRect.width - panelRect.width - 32) <= 2,
      tableFillsPanel: table.getBoundingClientRect().width >= (table.parentElement?.getBoundingClientRect().width ?? panelRect.width) - 2,
      actionColumnWidth: table.querySelector("col.wl-col-actions")?.getBoundingClientRect().width ?? 0
    };
  });
  check(
    "Workflows table fills its desktop content surface with a compact action column",
    workflowsLayout?.panelFillsPage && workflowsLayout.tableFillsPanel && workflowsLayout.actionColumnWidth <= 64,
    workflowsLayout ? JSON.stringify(workflowsLayout) : "workflow table not found"
  );
  const uiEvidenceDir = path.join(root, "reports", "ui-consistency");
  mkdirSync(uiEvidenceDir, { recursive: true });
  await win.screenshot({ path: path.join(uiEvidenceDir, "workflows-desktop.png"), fullPage: true }).catch(() => undefined);
  const initialTheme = await win.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "light");
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await win.screenshot({ path: path.join(uiEvidenceDir, "workflows-desktop-dark.png"), fullPage: true }).catch(() => undefined);
  await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), initialTheme);
  const workflowsResponsive = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await win.setViewportSize(viewport);
    await win.waitForTimeout(120);
    workflowsResponsive.push(await win.evaluate(({ width, height }) => {
      const page = document.querySelector(".workflows-library-page");
      const wrapper = document.querySelector(".workflows-library-panel .wl-table-wrapper");
      if (!page || !wrapper) return { width, height, valid: false };
      const pageRect = page.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      return {
        width,
        height,
        valid: page.scrollWidth <= page.clientWidth + 1 &&
          wrapperRect.left >= pageRect.left - 1 && wrapperRect.right <= pageRect.right + 1
      };
    }, viewport));
  }
  check(
    "Workflows library keeps its table surface contained at supported desktop widths",
    workflowsResponsive.every((result) => result.valid),
    JSON.stringify(workflowsResponsive)
  );
  await win.setViewportSize({ width: 1440, height: 900 });

  // Navigate to the Workflow Builder (sidebar may be expanded or collapsed).
  if (!(await win.$(".scenario-flow-node"))) {
    await win.click('button.nav-item:has(span:text-is("Workflow Builder"))').catch(() => {});
    if (!(await win.$(".scenario-flow-node"))) {
      await win.waitForTimeout(400);
      await win.click('button.nav-item[title="Workflow Builder"]').catch(() => {});
    }
  }
  await win.waitForSelector(".scenario-flow-node", { timeout: 20000 });
  await win.waitForTimeout(600);

  // --- 1. Custom engine renders scenario cards and connector paths (no React Flow DOM) ---
  const dom = await win.evaluate(() => ({
    reactFlowNodes: document.querySelectorAll(".react-flow__node").length,
    engineNodes: document.querySelectorAll(".awkit-flow-node[data-id]").length,
    scenarioCards: document.querySelectorAll(".scenario-flow-node").length,
    edges: document.querySelectorAll("g.awkit-flow-edge").length,
    background: Boolean(document.querySelector(".awkit-flow-background")),
    zoomControl: Boolean(document.querySelector(".canvas-zoom-control"))
  }));
  check("No React Flow nodes remain in the DOM", dom.reactFlowNodes === 0, `reactFlowNodes=${dom.reactFlowNodes}`);
  // The restored workflow's node count varies (whatever was last open); multi-node rendering is
  // asserted deterministically below via the new-workflow scaffold (Start+End) and the splice.
  check("Custom engine renders scenario flow cards", dom.engineNodes >= 1 && dom.scenarioCards === dom.engineNodes, `engineNodes=${dom.engineNodes} cards=${dom.scenarioCards}`);
  check("Dotted background + zoom control render", dom.background && dom.zoomControl, `bg=${dom.background} zoom=${dom.zoomControl}`);

  const toolbarLayout = await win.evaluate(() => {
    const toolbar = document.querySelector(".scenario-toolbar-compact");
    if (!toolbar) return null;
    const rect = toolbar.getBoundingClientRect();
    const historyButtons = [toolbar.querySelector("#sb-undo"), toolbar.querySelector("#sb-redo")]
      .filter(Boolean)
      .map((element) => element.getBoundingClientRect());
    return {
      height: rect.height,
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      overflowX: getComputedStyle(toolbar).overflowX,
      overflowY: getComputedStyle(toolbar).overflowY,
      groups: toolbar.querySelectorAll(".sb-toolbar-group").length,
      groupRects: [...toolbar.querySelectorAll(":scope > *")].map((element) => {
        const groupRect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label"), width: Math.round(groupRect.width), top: Math.round(groupRect.top - rect.top), height: Math.round(groupRect.height) };
      }),
      historyCompact: historyButtons.length === 2 && historyButtons.every((button) => button.width <= 36 && button.height <= 36)
    };
  });
  check(
    "Workflow command bar is a compact, non-scrolling command rail",
    toolbarLayout && toolbarLayout.height <= 60 && toolbarLayout.scrollWidth <= toolbarLayout.clientWidth + 1 && toolbarLayout.overflowX === "visible" && toolbarLayout.overflowY === "visible" && toolbarLayout.groups === 6 && toolbarLayout.historyCompact,
    toolbarLayout ? JSON.stringify(toolbarLayout) : "toolbar not found"
  );
  await win.screenshot({ path: path.join(uiEvidenceDir, "workflow-builder-command-bar.png"), fullPage: true }).catch(() => undefined);
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await win.screenshot({ path: path.join(uiEvidenceDir, "workflow-builder-command-bar-dark.png"), fullPage: true }).catch(() => undefined);
  await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), initialTheme);

  // --- 1a. Workflow Builder history uses the same bounded contract. ---
  const originalWorkflowName = await win.locator(WF_NAME_INPUT).inputValue();
  await win.locator(WF_NAME_INPUT).fill(`${originalWorkflowName} history edit`);
  await win.waitForTimeout(380);
  check("Workflow Builder Undo enables after a property edit", await win.locator("#sb-undo").isEnabled());
  await win.locator("#sb-undo").click();
  check("Workflow Builder Undo restores the prior property value", await win.locator(WF_NAME_INPUT).inputValue() === originalWorkflowName);
  await win.locator("#sb-redo").click();
  check("Workflow Builder Redo restores the edit", await win.locator(WF_NAME_INPUT).inputValue() === `${originalWorkflowName} history edit`);
  await win.locator(".sb-save-state").click();
  await win.keyboard.press("Control+z");
  check("Workflow Builder Ctrl+Z invokes editor Undo outside inputs", await win.locator(WF_NAME_INPUT).inputValue() === originalWorkflowName);
  await win.locator(WF_NAME_INPUT).focus();
  await win.keyboard.type("X");
  await win.keyboard.press("Control+z");
  check("Workflow Builder leaves native input Ctrl+Z local", await win.locator(WF_NAME_INPUT).inputValue() === originalWorkflowName);
  await win.waitForTimeout(380);

  // --- 2. Import-from-file: dirty guard, conflict guard, cancellation, dismissal, validation ---
  const incomingReplacement = importFixture("Incoming Replacement", ["verify-flow-a"]);
  await win.locator('.awkit-flow-node[data-id="verify-flow-a"] .scenario-flow-node').click();
  await win.fill(WF_NAME_INPUT, "Dirty canvas draft");
  await win.waitForFunction(() => document.querySelector(".sb-save-state")?.textContent?.includes("Unsaved changes"));
  const dirtyBaseline = await importState(win);

  await setImportFile(win, incomingReplacement);
  const discardDialog = win.getByRole("alertdialog");
  await discardDialog.waitFor({ state: "visible" });
  check(
    "Import over a dirty canvas prompts before discarding",
    (await discardDialog.textContent()).includes("Discard unsaved edits")
      && sameImportState(dirtyBaseline, await importState(win))
  );
  await discardDialog.getByRole("button", { name: "Discard edits" }).click();
  await win.getByRole("alertdialog").waitFor({ state: "visible" });
  const firstConflictText = (await win.getByRole("alertdialog").textContent()) ?? "";
  check(
    "ID collision dialog shows the saved and incoming workflow names",
    firstConflictText.includes("Verify — Workflow")
      && firstConflictText.includes("Incoming Replacement")
      && firstConflictText.includes("verify-workflow")
  );
  await win.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await win.waitForTimeout(150);
  const cancelledState = await importState(win);
  check(
    "Cancellation leaves storage, canvas, selection, and dirty state unchanged",
    sameImportState(dirtyBaseline, cancelledState),
    JSON.stringify(cancelledState)
  );

  await setImportFile(win, incomingReplacement);
  await win.getByRole("alertdialog").getByRole("button", { name: "Discard edits" }).click();
  await win.getByRole("alertdialog").waitFor({ state: "visible" });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(150);
  check(
    "Escape dismissal behaves as cancel",
    sameImportState(dirtyBaseline, await importState(win))
  );

  await setImportFile(win, incomingReplacement);
  await win.getByRole("alertdialog").getByRole("button", { name: "Discard edits" }).click();
  await win.getByRole("alertdialog").getByRole("button", { name: "Replace workflow" }).click();
  // The in-house canvas can emit a late measurement render for the outgoing node set. Sample only
  // after that bounded render window, then require the imported containment state to be present.
  await win.waitForTimeout(750);
  await win.waitForFunction(
    () => {
      const nodes = [...document.querySelectorAll(".awkit-flow-node[data-id]")];
      return nodes.length === 1 && nodes[0].getAttribute("data-id") === "verify-flow-a"
        && document.querySelectorAll("g.awkit-flow-edge").length === 0;
    },
    null,
    { timeout: 5000 }
  );
  const replacedState = await importState(win);
  check(
    "Confirmed replacement overwrites storage and loads the imported canvas",
    replacedState.stored?.name === "Incoming Replacement"
      && replacedState.nodes.length === 1
      && replacedState.nodes.includes("verify-flow-a")
      && replacedState.edges.length === 0
      && !replacedState.saveState.includes("Unsaved"),
    JSON.stringify(replacedState)
  );
  check("Loading another Workflow resets edit history", await win.locator("#sb-undo").isDisabled() && await win.locator("#sb-redo").isDisabled());

  const differentlyNamed = importFixture("Different Incoming Name", ["verify-flow-b"]);
  const cleanBaseline = await importState(win);
  await setImportFile(win, differentlyNamed);
  await win.getByRole("alertdialog").waitFor({ state: "visible" });
  const differentNameText = (await win.getByRole("alertdialog").textContent()) ?? "";
  check(
    "Same ID with a different name still conflicts and shows both names",
    differentNameText.includes("Incoming Replacement")
      && differentNameText.includes("Different Incoming Name")
      && differentNameText.includes("verify-workflow")
  );
  await win.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await win.waitForTimeout(150);
  const differentNameCancelled = await importState(win);
  check(
    "Different-name collision cancel preserves the loaded state",
    sameImportState(cleanBaseline, differentNameCancelled),
    JSON.stringify(differentNameCancelled)
  );

  const beforeInvalid = await importState(win);
  await setImportFile(win, { hello: "world" }, "invalid-workflow.json");
  await win.getByText(/Workflow id must be a non-empty string/).waitFor({ state: "visible" });
  check(
    "An invalid workflow file never touches storage or the canvas",
    sameImportState(beforeInvalid, await importState(win))
  );

  // Load a saved workflow with edges (so a cross-node connector exists for geometry).
  let edgeCountNow = dom.edges;
  if (edgeCountNow <= 1) {
    const options = await win.$$eval(`${WF_SELECT} option`, (els) => els.map((o) => ({ value: o.value, label: (o.textContent || "").trim() })));
    const ranked = [...options].sort((a, b) => {
      const score = (l) => (/failure|route|data|assert|recover|mock/i.test(l) ? 0 : 1);
      return score(a.label) - score(b.label);
    });
    for (const opt of ranked) {
      await win.selectOption(WF_SELECT, opt.value).catch(() => {});
      await win.waitForTimeout(900);
      edgeCountNow = await win.$$eval("g.awkit-flow-edge", (e) => e.length).catch(() => 0);
      if (edgeCountNow > 0 && (await win.$(".scenario-flow-node"))) {
        console.log(`  · loaded workflow with edges: "${opt.label}" (${edgeCountNow} edges)`);
        break;
      }
    }
    await win.waitForSelector(".scenario-flow-node", { timeout: 10000 });
    await win.waitForTimeout(400);
  }

  // Use the dedicated fixture whose persisted canvas ids intentionally differ from flowId. A
  // connector can only be reopened if the builder preserves those node ids on load.
  await win.selectOption(WF_SELECT, "verify-workflow-loop-authoring");
  await win.waitForTimeout(900);
  const distinctIdFixture = await win.evaluate(() => ({
    firstNode: document.querySelector('.awkit-flow-node[data-id="workflow-node-1"]')?.getAttribute("data-id"),
    hasExit: Boolean(document.querySelector('g.awkit-flow-edge[data-source="workflow-node-1"][data-target="workflow-node-2"]'))
  }));
  check(
    "Workflow load preserves persisted node ids when they differ from flow ids",
    distinctIdFixture.firstNode === "workflow-node-1" && distinctIdFixture.hasExit,
    JSON.stringify(distinctIdFixture)
  );

  // --- 3. Loop toggle via the node kebab menu creates/removes a self-loop connector ---
  const NODE = await win.evaluate(() => {
    const node = [...document.querySelectorAll(".awkit-flow-node[data-id]")].find((n) => n.querySelector(".scenario-flow-node.flowRef"));
    return node ? node.getAttribute("data-id") : null;
  });
  if (!NODE) {
    check("Add loop creates a self-loop connector", false, "no loopable scenario flow node found");
  } else {
    const activeWorkflowId = await win.inputValue(WF_SELECT);
    const defaultInsertControl = await win.evaluate(() => {
      const control = document.querySelector('button.awkit-edge-add[data-insert-role="default"]');
      const icon = control?.querySelector(".awkit-edge-add-icon");
      return control instanceof HTMLButtonElement
        ? {
            width: getComputedStyle(control).width,
            iconWidth: icon instanceof SVGElement ? getComputedStyle(icon).width : ""
          }
        : null;
    });
    const before = await win.evaluate(() => document.querySelectorAll("g.awkit-flow-edge").length);
    await clickNodeMenuItem(win, NODE, "Add loop");
    await win.waitForTimeout(450);
    const loop = await win.evaluate((id) => {
      const self = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
      return { count: document.querySelectorAll("g.awkit-flow-edge").length, hasSelfLoop: Boolean(self && self.querySelector("path.awkit-flow-edge-path")) };
    }, NODE);
    check("Add loop creates a self-loop connector", loop.count === before + 1 && loop.hasSelfLoop, `before=${before} after=${loop.count} selfLoop=${loop.hasSelfLoop}`);

    const loopMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    const loopEditorVisible = await loopMode.isVisible().catch(() => false);
    check("Adding a workflow loop selects it and opens the complete loop editor", loopEditorVisible, await win.locator(".scenario-properties-panel").textContent().catch(() => "panel missing"));
    if (loopEditorVisible) {
      await loopMode.selectOption("whileCondition");
      await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').fill("5");
      await win.locator('.scenario-properties-panel label:has-text("Line style") select').selectOption("dotted");
      await win.locator('.scenario-properties-panel label:has-text("Thickness") select').selectOption("4");
      await win.waitForTimeout(150);
      check("Workflow while-condition mode exposes structured condition authoring", await win.locator('.scenario-properties-panel label:has-text("Condition source") select').isVisible().catch(() => false));
      const visual = await readLoopVisual(win, NODE);
      const normalizeDash = (value) => String(value ?? "").replace(/px|,/g, " ").trim().replace(/\s+/g, " ");
      check(
        "Workflow Loop keeps the original centered curve with a semantic directional layer",
        visual?.connectorKind === "loop" && visual.className.includes("is-loop-connector") && visual.className.includes("nopan") &&
          visual.baseCount === 1 && visual.directionCount === 1 && visual.samePath &&
          Math.abs(visual.pathLeft - (visual.nodeLeft + visual.nodeRight) / 2) < 6 &&
          visual.pathRight > visual.pathLeft + 20 && visual.pathRight < visual.nodeRight,
        JSON.stringify(visual)
      );
      check(
        "Workflow Loop direction travels source-to-target without replacing authored style",
        visual?.animationName === "awkit-loop-direction" && visual.animationIterationCount === "infinite" && visual.animationTimingFunction === "linear" &&
          Number.parseFloat(visual.terminalOffset) < 0 && normalizeDash(visual.baseDash) === "1 5" && normalizeDash(visual.directionDash) === "8 92" &&
          Number.parseFloat(visual.directionWidth) > Number.parseFloat(visual.baseWidth),
        JSON.stringify(visual)
      );
      const loopExitControl = await readLoopExitControlVisual(win, NODE);
      const genericWidth = loopExitControl?.genericWidth || defaultInsertControl?.width || "1";
      const genericIconWidth = loopExitControl?.genericIconWidth || defaultInsertControl?.iconWidth || "1";
      const controlRatio = Number.parseFloat(loopExitControl?.width ?? "0") / Number.parseFloat(genericWidth);
      const iconRatio = Number.parseFloat(loopExitControl?.iconWidth ?? "0") / Number.parseFloat(genericIconWidth);
      check(
        "Workflow Loop exit uses the larger semantic insert control while default controls stay unchanged",
        loopExitControl?.role === "loop-exit" && loopExitControl.className.includes("is-loop-exit-affordance") &&
          loopExitControl.ariaLabel === "Insert step on loop exit" && controlRatio >= 1.3 && controlRatio <= 1.5 &&
          Number.parseFloat(genericWidth) === 24 && Number.parseFloat(genericIconWidth) === 10 &&
          iconRatio >= 1.3 && iconRatio <= 1.5 && loopExitControl.labelRole === "loop-exit" &&
          loopExitControl.labelText === "always" && !loopExitControl.selfHasControl,
        JSON.stringify({ ...loopExitControl, genericWidth, genericIconWidth, controlRatio, iconRatio })
      );
      check(
        "Workflow Loop exit control stays centered and clear of its label, nodes, and nearby controls",
        Number.isFinite(loopExitControl?.pathDistance) && loopExitControl.pathDistance < 3 && loopExitControl.labelClearance >= 2 &&
          !loopExitControl.overlapsLabel && !loopExitControl.overlapsSource && !loopExitControl.overlapsTarget && !loopExitControl.overlapsOtherControl &&
          !loopExitControl.haloOverlapsLabel && !loopExitControl.haloOverlapsSource && !loopExitControl.haloOverlapsTarget && !loopExitControl.haloOverlapsOtherControl,
        JSON.stringify(loopExitControl)
      );
      check(
        "Workflow Loop exit ring has a calm continuous halo coordinated with connector motion",
        loopExitControl?.haloAnimationName === "awkit-loop-exit-halo" && loopExitControl.haloIterationCount === "infinite" &&
          Number.parseFloat(loopExitControl.haloDuration) >= 1.5 && Number.parseFloat(loopExitControl.haloDuration) <= 2.5 &&
          loopExitControl.haloContent !== "none",
        JSON.stringify(loopExitControl)
      );
      await win.emulateMedia({ reducedMotion: "reduce" });
      const reducedVisual = await readLoopVisual(win, NODE);
      const reducedLoopExitControl = await readLoopExitControlVisual(win, NODE);
      check(
        "Workflow Loop directional motion honors reduced motion",
        reducedVisual?.display === "none" && reducedVisual.animationName === "none",
        JSON.stringify(reducedVisual)
      );
      check(
        "Workflow Loop exit halo becomes a static ring under reduced motion",
        reducedLoopExitControl?.haloAnimationName === "none" && Number.parseFloat(reducedLoopExitControl.haloOpacity) > 0,
        JSON.stringify(reducedLoopExitControl)
      );
      await win.emulateMedia({ reducedMotion: "no-preference" });
      if (loopExitControl?.edgeId) {
        await win.locator(`button.awkit-edge-add[data-edge-id="${loopExitControl.edgeId}"]`).click();
        await win.waitForTimeout(180);
        check(
          "The enlarged Workflow Loop exit control remains an accurate click target",
          await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false)
        );
        await win.keyboard.press("Escape");
      }
      await win.getByRole("button", { name: "Save", exact: true }).click();
      await win.waitForTimeout(350);
      const savedLoopAuthoring = await win.evaluate(async ({ sourceId, workflowId }) => {
        const profile = await window.playwrightFlowStudio.workflows.get(workflowId);
        const loopEdge = profile?.edges.find((edge) => edge.source === sourceId && edge.target === sourceId);
        const exit = profile?.edges.find((edge) => edge.source === sourceId && edge.target !== sourceId);
        return { loopEdge, exit };
      }, { sourceId: NODE, workflowId: activeWorkflowId });
      check(
        "Workflow save persists loop mode, bound, and while condition",
        savedLoopAuthoring.loopEdge?.type === "loop" &&
          savedLoopAuthoring.loopEdge?.loop?.mode === "whileCondition" &&
          savedLoopAuthoring.loopEdge?.loop?.maxIterations === 5 &&
          savedLoopAuthoring.loopEdge?.loop?.condition?.sourceField === "status",
        JSON.stringify(savedLoopAuthoring.loopEdge)
      );
      check(
        "Adding the workflow loop promotes the existing Standard path to a persisted Conditional exit",
        savedLoopAuthoring.exit?.type === "conditional" && savedLoopAuthoring.exit?.condition?.expression === "true" &&
          !("insertControlRole" in savedLoopAuthoring.exit) && !("showAddButton" in savedLoopAuthoring.exit),
        JSON.stringify(savedLoopAuthoring.exit)
      );

      const otherWorkflowId = await win.$$eval(`${WF_SELECT} option`, (options, activeId) =>
        options.map((option) => option.value).find((value) => value && value !== activeId) ?? "",
        activeWorkflowId
      );
      if (otherWorkflowId) {
        await win.selectOption(WF_SELECT, otherWorkflowId);
        await win.waitForTimeout(650);
        await win.selectOption(WF_SELECT, activeWorkflowId);
        await win.waitForTimeout(750);
      }
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      await win.waitForTimeout(180);
      await clickNodeMenuItem(win, NODE, "Configure loop");
      const reopenedByMenu = await loopMode.isVisible().catch(() => false);
      const reopenedMode = reopenedByMenu ? await loopMode.inputValue() : "";
      const reopenedMax = reopenedByMenu ? await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue() : "";
      const selectedByMenu = await win.evaluate((id) => Boolean(
        document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"] .awkit-flow-edge-path.is-selected`)
      ), NODE);
      check(
        "Configure loop reopens the saved Workflow Loop after switching workflows",
        reopenedByMenu && reopenedMode === "whileCondition" && reopenedMax === "5" && selectedByMenu,
        JSON.stringify({ reopenedByMenu, reopenedMode, reopenedMax, selectedByMenu })
      );
      if (reopenedByMenu) {
        await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').fill("7");
        await win.locator(`.awkit-flow-node[data-id="${NODE}"] .scenario-flow-node`).click();
        await clickNodeMenuItem(win, NODE, "Configure loop");
        check(
          "Configure loop reopens the existing Workflow Loop with unsaved edits intact",
          await loopMode.isVisible().catch(() => false) && await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue() === "7"
        );
        await win.getByRole("button", { name: "Save", exact: true }).click();
        await win.waitForTimeout(350);
        if (otherWorkflowId) {
          await win.selectOption(WF_SELECT, otherWorkflowId);
          await win.waitForTimeout(650);
          await win.selectOption(WF_SELECT, activeWorkflowId);
          await win.waitForTimeout(750);
        }
        await win.locator(`.awkit-flow-node[data-id="${NODE}"] .scenario-flow-node`).click();
        await clickNodeMenuItem(win, NODE, "Configure loop");
        const persistedMax = await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue().catch(() => "");
        const persistedVisual = await readLoopVisual(win, NODE);
        check(
          "Reconfigured Workflow Loop persists and remains directionally animated after reload",
          persistedMax === "7" && persistedVisual?.animationName === "awkit-loop-direction" && persistedVisual.animationIterationCount === "infinite",
          JSON.stringify({ persistedMax, persistedVisual })
        );
      }
    }

    const loopActions = await loopMenuLabels(win, NODE);
    check(
      "Existing workflow Loop exposes separate Configure and Remove controls",
      loopActions.includes("Configure loop") && loopActions.includes("Remove loop") && !loopActions.includes("Add loop"),
      JSON.stringify(loopActions)
    );

    await clickNodeMenuItem(win, NODE, "Remove loop");
    await win.waitForTimeout(400);
    const after = await win.evaluate((id) => ({
      count: document.querySelectorAll("g.awkit-flow-edge").length,
      hasSelfLoop: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)),
      hasLoopExitControl: Boolean(document.querySelector('button.awkit-edge-add[data-insert-role="loop-exit"]'))
    }), NODE);
    check(
      "Removing the workflow loop deletes the connector and clears its exit-control emphasis",
      !after.hasSelfLoop && !after.hasLoopExitControl && after.count === before,
      JSON.stringify({ ...after, baseline: before })
    );
  }

  // --- 4. New workflows use the structural Start -> End scaffold and contextual picker ---
  // "New" now prompts for a workflow name (points 6/7), then creates + loads that workflow.
  await win.click("#sb-new");
  await win.waitForTimeout(300);
  await win.fill('.modal-dialog input[type="text"]', `GUI New ${Date.now().toString(36)}`).catch(() => {});
  await win.click('.modal-dialog button[type="submit"]').catch(() => {});
  await win.waitForTimeout(600);
  const scaffold = await win.evaluate(() => ({
    starts: document.querySelectorAll(".scenario-flow-node.start").length,
    ends: document.querySelectorAll(".scenario-flow-node.end").length,
    edges: document.querySelectorAll("g.awkit-flow-edge").length,
    legacyPanelVisible: [...document.querySelectorAll(".scenario-side-panel")].some((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    })
  }));
  check("New workflow renders Start and End connected by default", scaffold.starts === 1 && scaffold.ends === 1 && scaffold.edges === 1, JSON.stringify(scaffold));
  check("Permanent Workflow Definition panel is not visible", !scaffold.legacyPanelVisible, `visible=${scaffold.legacyPanelVisible}`);

  await win.locator(".awkit-flow-canvas").click({ button: "right", position: { x: 120, y: 110 } });
  await win.waitForTimeout(250);
  const contextPicker = await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false);
  check("Blank-canvas right click opens contextual Workflow Definition", contextPicker, `visible=${contextPicker}`);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // --- 5. Default edge "+" splices Start -> flow -> End ---
  const insertBtn = win.locator('.awkit-edge-add[data-insert-role="default"]').first();
  if (await insertBtn.isVisible().catch(() => false)) {
    await insertBtn.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })));
    await win.waitForTimeout(250);
    check("Default edge + opens Workflow Definition in insertion mode", await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false));
    await win.locator('.canvas-item-picker section:has(h3:has-text("Saved Flows")) [role="menuitem"]').first().click();
    await win.waitForFunction(() => document.querySelectorAll(".scenario-flow-node").length === 3 && document.querySelectorAll("g.awkit-flow-edge").length === 2, null, { timeout: 2000 }).catch(() => {});
    const inserted = await win.evaluate(() => ({ nodes: document.querySelectorAll(".scenario-flow-node").length, edges: document.querySelectorAll("g.awkit-flow-edge").length }));
    check("Selecting a flow on the default edge splices Start -> flow -> End", inserted.nodes === 3 && inserted.edges === 2, JSON.stringify(inserted));
    await win.locator(".scenario-flow-node.flowRef").first().click();
    await win.waitForTimeout(200);
    check("Selecting a workflow flow opens its real configuration drawer", await win.getByText("Flow Configuration", { exact: true }).isVisible().catch(() => false));
  } else {
    check("Default edge + opens Workflow Definition in insertion mode", false, "SKIPPED: no insert + visible on the new scaffold");
  }

  // --- 4b. Add menu exposes the Flow Logic section (Conditional / Parallel / Loop) ---
  await win.click("#sb-add-flow");
  await win.waitForTimeout(300);
  const logicMenu = await win.evaluate(() => {
    const picker = document.querySelector('.canvas-item-picker[aria-label="Workflow Definition"]');
    if (!picker) return { present: false, labels: [] };
    const section = [...picker.querySelectorAll("section")].find((s) => /flow logic/i.test(s.querySelector("h3")?.textContent || ""));
    if (!section) return { present: false, labels: [] };
    return { present: true, labels: [...section.querySelectorAll('[role="menuitem"] strong')].map((el) => (el.textContent || "").trim()) };
  });
  check("Add menu has a Flow Logic section", logicMenu.present, JSON.stringify(logicMenu.labels));
  check(
    "Flow Logic exposes Conditional Branch, Parallel Branch, and Loop",
    ["Conditional Branch", "Parallel Branch", "Loop"].every((l) => logicMenu.labels.includes(l)),
    JSON.stringify(logicMenu.labels)
  );
  await win.keyboard.press("Escape");
  await win.waitForTimeout(150);

  // --- 4c. Selecting a flow highlights it, and Flow Logic › Loop toggles its self-loop ---
  const flowCard = win.locator(".scenario-flow-node.flowRef").first();
  if (await flowCard.isVisible().catch(() => false)) {
    await flowCard.click();
    await win.waitForTimeout(220);
    const loopTargetId = await win.evaluate(() => {
      const nodes = [...document.querySelectorAll(".awkit-flow-node[data-id]")];
      const node = nodes.find((n) => n.querySelector(".scenario-flow-node.flowRef.selected")) || nodes.find((n) => n.querySelector(".scenario-flow-node.flowRef"));
      return node ? node.getAttribute("data-id") : null;
    });
    check("Clicking a flow node applies the .selected highlight", Boolean(await win.$(".scenario-flow-node.flowRef.selected")), `id=${loopTargetId}`);
    const loopBefore = await win.evaluate((id) => Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)), loopTargetId);
    await win.click("#sb-add-flow");
    await win.waitForTimeout(250);
    await win.evaluate(() => {
      const item = [...document.querySelectorAll('.canvas-item-picker [role="menuitem"]')].find((b) => /^Loop$/i.test((b.querySelector("strong")?.textContent || "").trim()));
      if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await win.waitForTimeout(420);
    const loopAfter = await win.evaluate((id) => Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)), loopTargetId);
    check("Flow Logic › Loop adds a self-loop connector to the selected flow", !loopBefore && loopAfter, `before=${loopBefore} after=${loopAfter}`);
  } else {
    check("Clicking a flow node applies the .selected highlight", false, "SKIPPED: no flowRef node present");
    check("Flow Logic › Loop adds a self-loop connector to the selected flow", false, "SKIPPED: no flowRef node present");
  }

  // --- 5. Add Flow toolbar → leaf append "+" opens the contextual picker ---
  await win.click("#sb-add-flow");
  await win.waitForTimeout(250);
  await win.locator('.canvas-item-picker section:has(h3:has-text("Saved Flows")) [role="menuitem"]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const appendButton = win.locator(".node-append-affordance button").first();
  check("Blank add creates a leaf flow with an append +", await appendButton.isVisible().catch(() => false));
  await appendButton.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))).catch(() => {});
  await win.waitForTimeout(350);
  check("Workflow leaf + opens the contextual Workflow Definition", await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false));
  await win.keyboard.press("Escape");

  // Resize only after the functional walkthrough so responsive layout state cannot perturb later gestures.
  const responsiveToolbar = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await win.setViewportSize(viewport);
    await win.waitForTimeout(180);
    responsiveToolbar.push(await win.evaluate(({ width, height }) => {
      const toolbar = document.querySelector(".scenario-toolbar-compact");
      if (!toolbar) return { width, height, valid: false };
      const rect = toolbar.getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll("button:not([hidden]), input:not([type=file]), select")];
      const maxHeight = width <= 1024 ? 132 : width <= 1280 ? 104 : 60;
      const noHorizontalScroll = toolbar.scrollWidth <= toolbar.clientWidth + 1;
      const controlsContained = controls.every((control) => {
        const controlRect = control.getBoundingClientRect();
        return controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1;
      });
      return {
        width,
        height,
        barHeight: Math.round(rect.height),
        controlCount: controls.length,
        noHorizontalScroll,
        controlsContained,
        valid: noHorizontalScroll &&
          rect.height <= maxHeight &&
          controls.length >= 11 &&
          controlsContained
      };
    }, viewport));
  }
  check(
    "Workflow command bar stays contained at 1024, 1280, 1440, and 1920 widths",
    responsiveToolbar.every((result) => result.valid),
    JSON.stringify(responsiveToolbar)
  );
  await win.setViewportSize({ width: 1024, height: 768 });
  await win.screenshot({ path: path.join(uiEvidenceDir, "workflow-builder-narrow.png"), fullPage: true }).catch(() => undefined);

  check("Workflow Builder walkthrough emits no renderer console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} GUI checks passed`);
  await app.close();
  cleanup();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error("GUI walkthrough error:", err);
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  cleanup();
  process.exit(2);
}
