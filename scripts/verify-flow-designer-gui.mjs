// Real GUI walkthrough of the Flow Designer canvas.
//
// Launches the actual built Electron app (main + preload + renderer) via Playwright's
// _electron API and drives the Flow Designer, asserting on the real rendered DOM/SVG. The
// canvas now runs on the in-house engine (app/renderer/components/canvas) — no React Flow —
// so this exercises the engine's DOM: `.awkit-flow-node[data-id]` cards, `g.awkit-flow-edge`
// connectors, the contextual Node Palette, the append/insert "+" affordances, and the
// kebab-menu loop toggle. Branch-port geometry checks were removed with the port model.
//
// Runs against an ISOLATED, empty %LOCALAPPDATA% and signs in past the SecurityGate first-run
// (PR #15 gates every route until authenticated), then seeds one multi-node flow so the designer
// auto-opens it (FlowChartDesigner loads profiles[0]). See bd awkit-gmn.
//
// Run: node scripts/verify-flow-designer-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { navClick } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-flow-designer-gui");
seedFlowFixture(dataRoot);

// Seed a single flow with action nodes + a connector so the designer canvas has something to render
// (start → goto → fill → click → end): satisfies the >=2 action-node, cross-node edge, and loopable
// action-node assertions below without depending on the developer's real profile.
function seedFlowFixture(localAppData) {
  const now = new Date().toISOString();
  const flowsDir = path.join(localAppData, "SpecterStudio", "flows");
  mkdirSync(flowsDir, { recursive: true });
  const flow = {
    id: "verify-flow-designer",
    name: "Verify — Flow Designer",
    description: "Multi-node fixture for the Flow Designer GUI verifier.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "goto", type: "goto", name: "Open Page", url: "http://localhost:4321/login", valueSource: { type: "static", value: "http://localhost:4321/login" } },
      { id: "fill", type: "fill", name: "Fill Username", locator: { strategy: "id", value: "username" }, valueSource: { type: "static", value: "user1" } },
      { id: "click", type: "click", name: "Submit", locator: { strategy: "id", value: "loginButton" } },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "fill", type: "success" },
      { id: "e2", source: "fill", target: "click", type: "success" },
      { id: "e3", source: "click", target: "end", type: "success" }
    ]
  };
  writeFileSync(path.join(flowsDir, `${flow.id}.json`), `${JSON.stringify(flow, null, 2)}\n`, "utf8");

  const positionalFlow = {
    id: "verify-positional-approval",
    name: "Verify Positional Approval",
    description: "Increment 3/4 locator approval lifecycle fixture.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      {
        id: "positional",
        type: "click",
        name: "Pick second option",
        locator: {
          strategy: "css",
          value: ".pos-btn >> nth=1",
          quality: {
            strategy: "fallback",
            isUnique: true,
            matchCount: 1,
            confidence: "low",
            disambiguation: "positional",
            warning: "Fragile positional fallback"
          },
          resolution: "needs-review",
          resolvedBy: "recorder",
          reviewReason: "only position distinguishes these controls"
        }
      },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e0", source: "start", target: "positional", type: "success" },
      { id: "e1", source: "positional", target: "end", type: "success" }
    ]
  };
  writeFileSync(path.join(flowsDir, `${positionalFlow.id}.json`), `${JSON.stringify(positionalFlow, null, 2)}\n`, "utf8");

  // Stage 2b fixtures: an INVALID draft flow (missing locator on the active path + an orphan
  // node off it) and two one-flow workflows, so the walkthrough can assert the draft-save model,
  // the derived library status and the run gate's blocking policy end-to-end.
  const invalidFlow = {
    id: "verify-invalid-draft",
    name: "Verify Invalid Draft",
    description: "Invalid fixture: blocking missing locator + non-blocking orphan node.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
      { id: "click", type: "click", name: "Unlocated Click", position: { x: 280, y: 220 } },
      { id: "orphan", type: "screenshot", name: "Orphan Shot", position: { x: 640, y: 80 }, config: { screenshotName: "orphan" } },
      { id: "end", type: "end", name: "End", position: { x: 280, y: 360 } }
    ],
    edges: [
      { id: "e0", source: "start", target: "click", type: "success" },
      { id: "e1", source: "click", target: "end", type: "success" }
    ]
  };
  writeFileSync(path.join(flowsDir, `${invalidFlow.id}.json`), `${JSON.stringify(invalidFlow, null, 2)}\n`, "utf8");

  // Stage 2c fixtures. `verify-zc-legacy-flow`: an orphan node and nothing else — off-path-only, so
  // the inventory scan grants it Legacy Compatibility. `verify-zc-fixable-flow`: casing-only enum
  // mistakes, the entire safe-fix surface.
  const legacyFlow = {
    id: "verify-zc-legacy-flow",
    name: "Verify Legacy Flow",
    description: "Off-path-only fixture: eligible for a Legacy Compatibility grant.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
      { id: "click", type: "click", name: "Click", locator: { strategy: "id", value: "go" }, position: { x: 280, y: 220 } },
      { id: "orphan", type: "screenshot", name: "Orphan Shot", position: { x: 640, y: 80 }, config: { screenshotName: "orphan" } },
      { id: "end", type: "end", name: "End", position: { x: 280, y: 360 } }
    ],
    edges: [
      { id: "e0", source: "start", target: "click", type: "success" },
      { id: "e1", source: "click", target: "end", type: "success" }
    ]
  };
  writeFileSync(path.join(flowsDir, `${legacyFlow.id}.json`), `${JSON.stringify(legacyFlow, null, 2)}\n`, "utf8");

  const fixableFlow = {
    id: "verify-zc-fixable-flow",
    name: "Verify Fixable Flow",
    description: "Casing-only enum mistakes — the safe-fix surface.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
      { id: "click", type: "click", name: "Click", locator: { strategy: "id", value: "go" }, position: { x: 280, y: 220 } },
      { id: "end", type: "end", name: "End", position: { x: 280, y: 360 } }
    ],
    edges: [
      { id: "e0", source: "start", target: "click", type: "success" },
      { id: "e-cond", source: "click", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "Outcome", operator: "NotEquals", expectedValue: "fail" } }
    ]
  };
  writeFileSync(path.join(flowsDir, `${fixableFlow.id}.json`), `${JSON.stringify(fixableFlow, null, 2)}\n`, "utf8");

  const workflowsDir = path.join(localAppData, "SpecterStudio", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  const workflowFor = (id, name, flowId) => ({
    id,
    name,
    description: "Stage 2b run-gate fixture.",
    version: 1,
    nodes: [
      { id: "start", type: "start", alias: "Start", order: 0 },
      { id: "node-flow", type: "flowRef", flowId, alias: flowId, order: 1, required: true, inputBindings: {} },
      { id: "end", type: "end", alias: "End", order: 2 }
    ],
    edges: [
      { id: "e-start", source: "start", target: "node-flow", type: "always" },
      { id: "e-end", source: "node-flow", target: "end", type: "always" }
    ],
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true },
    createdAt: now,
    updatedAt: now
  });
  for (const workflow of [
    workflowFor("verify-wf-valid", "Verify WF Valid", "verify-flow-designer"),
    workflowFor("verify-wf-invalid", "Verify WF Invalid", "verify-invalid-draft"),
    workflowFor("verify-wf-legacy", "Verify WF Legacy", "verify-zc-legacy-flow")
  ]) {
    writeFileSync(path.join(workflowsDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function readInspectorGeometry(win) {
  return win.evaluate(() => {
    const canvas = document.querySelector(".designer-canvas");
    const canvasArea = document.querySelector(".flow-designer-body");
    const canvasEngine = document.querySelector(".react-flow-shell");
    const toolbar = document.querySelector(".flow-action-bar");
    const panel = document.querySelector(".designer-right-drawer-slot > .properties-panel");
    if (!canvas || !canvasArea || !canvasEngine || !toolbar || !panel) return null;
    const c = canvas.getBoundingClientRect();
    const a = canvasArea.getBoundingClientRect();
    const e = canvasEngine.getBoundingClientRect();
    const t = toolbar.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      canvasLeft: c.left,
      canvasRight: c.right,
      canvasWidth: c.width,
      canvasAreaTop: a.top,
      canvasAreaBottom: a.bottom,
      canvasEngineRight: e.right,
      canvasEngineWidth: e.width,
      // The floating drawer reserves usable canvas room via padding-right on .flow-designer-body
      // (see global.css .designer-layout.has-right-panel .flow-designer-body) rather than by shrinking
      // the full-width .react-flow-shell — so the inset lives here, not in the engine width.
      bodyPaddingRight: parseFloat(getComputedStyle(canvasArea).paddingRight) || 0,
      toolbarRight: t.right,
      panelLeft: p.left,
      panelTop: p.top,
      panelRight: p.right,
      panelBottom: p.bottom,
      panelWidth: p.width
    };
  });
}

/**
 * Wait for the Node Properties drawer's open/resize transition to actually finish, then read the
 * geometry (awkit-73s).
 *
 * A fixed delay after opening or resizing sampled the layout mid-transition. Two independent
 * mechanisms move this layout, so a single fixed number could never be reliably long enough:
 *   1. CSS on the drawer subtree — `.flow-designer-body`'s `padding-right` (the canvas inset) and
 *      `.designer-right-drawer-slot`'s `width` both run a 240ms transition, and the panel itself
 *      (`.properties-panel.template-config-drawer`) runs the `awkit-config-drawer-in` keyframe
 *      (opacity/transform) at the same time. Measured live: the padding-right transition was still
 *      only ~87% complete at 500ms — nearly double its declared 240ms duration.
 *   2. The action bar's height, measured live by a `ResizeObserver` in `DesignerCanvasLayout.tsx`
 *      (`--awkit-action-bar-h`, which the drawer slot's padding-top depends on). That is not a CSS
 *      animation and cannot appear in `getAnimations()`, so it needs a second, different wait.
 *
 * Step 1 awaits every `Animation` (`getAnimations()` returns running CSS transitions as well as
 * keyframe animations) on the drawer subtree. Step 2 polls the geometry for two identical
 * consecutive reads. That polling is safe here — unlike an `animation-fill-mode: both` keyframe,
 * whose frozen pre-start frame can itself read as "stable" — because nothing here holds a fixed
 * frame before the transition begins: the geometry changes continuously from the moment the drawer
 * opens or the viewport resizes, so two equal reads mean arrival, not a frozen start state.
 */
async function waitForDrawerSettled(win) {
  // Let the transition/animation actually start — a property change and the animation/transition it
  // triggers are not guaranteed to be observable in the same tick.
  await win.waitForTimeout(50);
  await win.evaluate(async () => {
    const targets = [
      document.querySelector(".flow-designer-body"),
      document.querySelector(".designer-right-drawer-slot"),
      document.querySelector(".designer-right-drawer-slot > .properties-panel"),
      document.querySelector(".designer-right-drawer-slot > .flow-properties-panel"),
      document.querySelector(".designer-right-drawer-slot > .connection-properties-panel")
    ].filter(Boolean);
    const animations = targets.flatMap((el) => el.getAnimations());
    await Promise.allSettled(animations.map((a) => a.finished));
    // Two frames so the post-animation style/layout is committed before anything measures it.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  let previous = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const current = await readInspectorGeometry(win);
    const serialized = JSON.stringify(current);
    if (current && serialized === previous) return current;
    previous = serialized;
    await win.waitForTimeout(40);
  }
  return readInspectorGeometry(win);
}

// Open the node's kebab ("…") menu and click its loop item (Add/Remove loop). The menu portals
// into #root, so synthetic bubbling clicks fire React's delegated onClick reliably even when the
// canvas overlaps the target.
async function clickLoopMenuItem(win, nodeId) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  await win.evaluate(() => {
    const item = [...document.querySelectorAll(".node-options-menu .node-options-item")].find((b) => /loop/i.test(b.textContent || ""));
    if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await win.waitForTimeout(150);
}

// Read the loop menu item label ("Add loop" | "Remove loop") without activating it.
async function loopItemLabel(win, nodeId) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  const label = await win.evaluate(
    () => ([...document.querySelectorAll(".node-options-menu .node-options-item")].find((b) => /loop/i.test(b.textContent || ""))?.textContent || "").trim()
  );
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(80);
  return label;
}

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await resolveMainWindow(app);
  const pageErrors = [];
  const consoleErrors = [];
  win.on("pageerror", (error) => pageErrors.push(error.message));
  win.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.setViewportSize({ width: 1440, height: 900 });

  // Ensure we're on the Flow Designer (the app restores the last route).
  if (!(await win.$(".action-flow-node"))) {
    await win.click('button.nav-item:has-text("Flow Designer")').catch(() => {});
  }
  await win.waitForSelector(".action-flow-node", { timeout: 20000 });
  await win.waitForTimeout(600);

  // --- 1. Custom engine renders node cards and connector paths (no React Flow DOM) ---
  const dom = await win.evaluate(() => ({
    reactFlowNodes: document.querySelectorAll(".react-flow__node").length,
    engineNodes: document.querySelectorAll(".awkit-flow-node[data-id]").length,
    actionCards: document.querySelectorAll(".action-flow-node").length,
    edges: document.querySelectorAll("g.awkit-flow-edge").length,
    edgePaths: document.querySelectorAll("path.awkit-flow-edge-path").length,
    background: Boolean(document.querySelector(".awkit-flow-background")),
    zoomControl: Boolean(document.querySelector(".canvas-zoom-control"))
  }));
  check("No React Flow nodes remain in the DOM", dom.reactFlowNodes === 0, `reactFlowNodes=${dom.reactFlowNodes}`);
  check("Custom engine renders node cards", dom.engineNodes >= 2 && dom.actionCards >= 2, `engineNodes=${dom.engineNodes} cards=${dom.actionCards}`);
  check("Connector paths render on the engine SVG layer", dom.edges >= 1 && dom.edgePaths >= 1, `edges=${dom.edges} paths=${dom.edgePaths}`);
  check("Dotted background + zoom control render", dom.background && dom.zoomControl, `bg=${dom.background} zoom=${dom.zoomControl}`);

  const commandBar = await win.evaluate(() => {
    const toolbar = document.querySelector(".flow-action-bar");
    if (!toolbar) return null;
    const historyButtons = [toolbar.querySelector('[data-testid="flow-undo"]'), toolbar.querySelector('[data-testid="flow-redo"]')]
      .filter(Boolean)
      .map((button) => button.getBoundingClientRect());
    return {
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      overflowX: getComputedStyle(toolbar).overflowX,
      groups: toolbar.querySelectorAll(".editor-command-group").length,
      compactHistory: historyButtons.length === 2 && historyButtons.every((button) => button.width <= 36 && button.height <= 36)
    };
  });
  check(
    "Flow Designer command bar is compact and does not scroll horizontally",
    commandBar && commandBar.scrollWidth <= commandBar.clientWidth + 1 && commandBar.overflowX === "visible" && commandBar.groups === 3 && commandBar.compactHistory,
    commandBar ? JSON.stringify(commandBar) : "command bar not found"
  );
  const responsiveCommandBar = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await win.setViewportSize(viewport);
    await win.waitForTimeout(120);
    responsiveCommandBar.push(await win.evaluate(({ width, height }) => {
      const toolbar = document.querySelector(".flow-action-bar");
      if (!toolbar) return { width, height, valid: false };
      const rect = toolbar.getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll("button:not([hidden]), input, select")];
      return {
        width,
        height,
        barHeight: Math.round(rect.height),
        valid: rect.height <= 64 &&
          toolbar.scrollWidth <= toolbar.clientWidth + 1 &&
          controls.every((control) => {
            const controlRect = control.getBoundingClientRect();
            return controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1;
          })
      };
    }, viewport));
  }
  check(
    "Flow Designer command bar stays contained at 1024, 1280, 1440, and 1920 widths",
    responsiveCommandBar.every((result) => result.valid),
    JSON.stringify(responsiveCommandBar)
  );
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForTimeout(180);

  // --- 1a. Bounded editor history is reachable by buttons and desktop shortcuts. ---
  const flowNameInput = win.locator('label:has-text("Flow Name") input');
  const originalFlowName = await flowNameInput.inputValue();
  await flowNameInput.fill(`${originalFlowName} history edit`);
  await win.waitForTimeout(380);
  check("Flow Designer Undo enables after a property edit", await win.locator('[data-testid="flow-undo"]').isEnabled());
  await win.locator('[data-testid="flow-undo"]').click();
  check("Flow Designer Undo restores the prior property value", await flowNameInput.inputValue() === originalFlowName);
  check("Flow Designer Redo enables after Undo", await win.locator('[data-testid="flow-redo"]').isEnabled());
  await win.locator('[data-testid="flow-redo"]').click();
  check("Flow Designer Redo restores the edit", await flowNameInput.inputValue() === `${originalFlowName} history edit`);
  await win.locator(".flow-action-bar").click({ position: { x: 2, y: 2 } });
  await win.keyboard.press("Control+z");
  check("Flow Designer Ctrl+Z invokes editor Undo outside inputs", await flowNameInput.inputValue() === originalFlowName);
  await flowNameInput.focus();
  await win.keyboard.type("X");
  await win.keyboard.press("Control+z");
  check("native input Ctrl+Z remains local to the text field", await flowNameInput.inputValue() === originalFlowName);
  await win.waitForTimeout(380);

  // --- 1b. A rapid pointer lifecycle must not leave a queued pan updater reading a released
  // gesture. This is the real originX crash path: pointer-up clears the gesture before React may
  // flush the pointer-move state update.
  const emptyPoint = await win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let y = rect.top + 24; y < rect.bottom - 24; y += 32) {
      for (let x = rect.left + 24; x < rect.right - 24; x += 32) {
        const element = document.elementFromPoint(x, y);
        if (element?.closest("[data-canvas-node], button, input, select, textarea, a")) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (emptyPoint) {
    await win.mouse.move(emptyPoint.x, emptyPoint.y);
    await win.mouse.down();
    await win.mouse.move(emptyPoint.x + 18, emptyPoint.y + 12);
    await win.mouse.up();
    await win.waitForTimeout(120);
  }
  check(
    "Rapid pane drag does not crash after the gesture is released",
    Boolean(emptyPoint) && pageErrors.length === 0 && !(await win.$(".error-boundary")),
    emptyPoint ? `pageErrors=${JSON.stringify(pageErrors)}` : "no empty canvas point found"
  );

  // Clear any restored selection, then prove the no-inspector state has exactly one grid child.
  // Rendering an empty drawer slot here creates an implicit second row and cuts the canvas in half.
  const clearPoint = await win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas")?.getBoundingClientRect();
    if (!canvas) return null;
    for (let y = canvas.bottom - 24; y > canvas.top + 24; y -= 32) {
      for (let x = canvas.left + 24; x < canvas.right - 24; x += 32) {
        if (!document.elementFromPoint(x, y)?.closest("[data-canvas-node], button, input, select, textarea, a")) return { x, y };
      }
    }
    return null;
  });
  if (clearPoint) await win.mouse.click(clearPoint.x, clearPoint.y);
  await win.waitForTimeout(120);
  const fullHeightLayout = await win.evaluate(() => {
    const layout = document.querySelector(".designer-layout");
    const canvas = document.querySelector(".designer-canvas");
    const engine = document.querySelector(".awkit-flow-canvas");
    if (!layout || !canvas || !engine) return null;
    const l = layout.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const e = engine.getBoundingClientRect();
    return {
      layoutHeight: l.height,
      layoutWidth: l.width,
      canvasHeight: c.height,
      canvasWidth: c.width,
      canvasBottom: c.bottom,
      engineBottom: e.bottom,
      drawerSlots: layout.querySelectorAll(":scope > .designer-right-drawer-slot").length,
      hasRightPanel: layout.classList.contains("has-right-panel")
    };
  });
  check(
    "Canvas fills the designer height when no properties inspector is open",
    fullHeightLayout && !fullHeightLayout.hasRightPanel && fullHeightLayout.drawerSlots === 0 &&
      Math.abs(fullHeightLayout.canvasHeight - fullHeightLayout.layoutHeight) <= 1 &&
      Math.abs(fullHeightLayout.canvasWidth - fullHeightLayout.layoutWidth) <= 1 &&
      Math.abs(fullHeightLayout.engineBottom - fullHeightLayout.canvasBottom) <= 1,
    fullHeightLayout ? JSON.stringify(fullHeightLayout) : "layout not found"
  );

  // --- 2. Edges flow top→bottom (leave the source's bottom, enter the target's top) ---
  const geometry = await win.evaluate(() => {
    const edge = [...document.querySelectorAll("g.awkit-flow-edge")].find((g) => g.getAttribute("data-source") !== g.getAttribute("data-target"));
    if (!edge) return null;
    const source = document.querySelector(`.awkit-flow-node[data-id="${edge.getAttribute("data-source")}"]`);
    const target = document.querySelector(`.awkit-flow-node[data-id="${edge.getAttribute("data-target")}"]`);
    const path = edge.querySelector("path.awkit-flow-edge-path");
    if (!source || !target || !path) return null;
    const s = source.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const p = path.getBoundingClientRect();
    return { sourceBottom: s.bottom, targetTop: t.top, pathTop: p.top, pathBottom: p.bottom };
  });
  check(
    "A connector spans from the source node's bottom to the target node's top",
    geometry && geometry.pathTop <= geometry.sourceBottom + 8 && geometry.pathBottom >= geometry.targetTop - 8,
    geometry ? `pathTop=${geometry.pathTop.toFixed(0)} sourceBottom=${geometry.sourceBottom.toFixed(0)} pathBottom=${geometry.pathBottom.toFixed(0)} targetTop=${geometry.targetTop.toFixed(0)}` : "no cross-node edge found"
  );

  // --- 2b. The properties inspector INSETS the canvas (awkit-73s): opening it reduces
  // .react-flow-shell's usable width via padding-right on .flow-designer-body and shifts the
  // workflow left, so the drawer never covers nodes or connections — its right edge must meet the
  // engine's right edge, not float over it. (The comment this replaced described a floating-overlay
  // design from the Hologram re-skin; a live measurement showed the settled layout never actually
  // reaches that state — see awkit-73s.) ---
  const inspectablePoint = await win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas")?.getBoundingClientRect();
    if (!canvas) return null;
    for (const node of document.querySelectorAll(".awkit-flow-node[data-id]")) {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x <= canvas.left || x >= canvas.right || y <= canvas.top || y >= canvas.bottom) continue;
      if (document.elementFromPoint(x, y)?.closest(".awkit-flow-node") === node) return { x, y };
    }
    return null;
  });
  if (inspectablePoint) await win.mouse.click(inspectablePoint.x, inspectablePoint.y);
  const expandedLayout = await waitForDrawerSettled(win);
  check(
    "Node Properties insets the canvas and sits flush against its right edge, without covering nodes",
    Boolean(inspectablePoint) && expandedLayout &&
      Math.abs(expandedLayout.canvasWidth - fullHeightLayout.canvasWidth) <= 1 &&
      Math.abs(expandedLayout.toolbarRight - expandedLayout.canvasRight) <= 1 &&
      expandedLayout.panelWidth < expandedLayout.canvasWidth &&
      expandedLayout.panelLeft >= expandedLayout.canvasLeft &&
      expandedLayout.panelRight <= expandedLayout.canvasRight + 4 &&
      // Inset, not overlay: usable engine width shrinks by (about) the drawer's width, and the
      // engine's right edge meets the drawer's left edge rather than running underneath it.
      expandedLayout.canvasEngineWidth < expandedLayout.canvasWidth - 4 &&
      expandedLayout.canvasEngineRight <= expandedLayout.panelLeft + 2,
    expandedLayout ? JSON.stringify(expandedLayout) : "no hit-testable node or inspector did not open"
  );
  check(
    "Node Properties stays within the vertical canvas area below the action bar",
    expandedLayout &&
      expandedLayout.panelTop >= expandedLayout.canvasAreaTop - 2 &&
      expandedLayout.panelBottom <= expandedLayout.canvasAreaBottom + 2,
    expandedLayout ? JSON.stringify(expandedLayout) : "inspector geometry not found"
  );
  await win.setViewportSize({ width: 1936, height: 1290 });
  const wideLayout = await waitForDrawerSettled(win);
  check(
    "Node Properties still insets the canvas (no overlap) at the reported 1936x1290 viewport",
    wideLayout &&
      wideLayout.viewportWidth === 1936 && wideLayout.viewportHeight === 1290 &&
      Math.abs(wideLayout.toolbarRight - wideLayout.canvasRight) <= 1 &&
      wideLayout.panelLeft >= wideLayout.canvasLeft &&
      wideLayout.panelRight <= wideLayout.canvasRight + 4 &&
      wideLayout.panelTop >= wideLayout.canvasAreaTop - 2 &&
      wideLayout.panelBottom <= wideLayout.canvasAreaBottom + 2 &&
      wideLayout.canvasEngineWidth < wideLayout.canvasWidth - 4 &&
      wideLayout.canvasEngineRight <= wideLayout.panelLeft + 2,
    wideLayout ? JSON.stringify(wideLayout) : "wide inspector geometry not found"
  );
  if (process.env.AWKIT_FLOW_DESIGNER_EVIDENCE) {
    await win.screenshot({ path: process.env.AWKIT_FLOW_DESIGNER_EVIDENCE });
  }
  if (process.env.AWKIT_FLOW_DESIGNER_EVIDENCE_DARK) {
    const initialTheme = await win.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "light");
    await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await win.screenshot({ path: process.env.AWKIT_FLOW_DESIGNER_EVIDENCE_DARK });
    await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), initialTheme);
  }
  await win.setViewportSize({ width: 1024, height: 768 });
  const compactLayout = await waitForDrawerSettled(win);
  check(
    "Node Properties insets the canvas (no overlap) when the toolbar wraps at a compact viewport",
    compactLayout &&
      compactLayout.viewportWidth === 1024 && compactLayout.viewportHeight === 768 &&
      Math.abs(compactLayout.toolbarRight - compactLayout.canvasRight) <= 1 &&
      compactLayout.panelLeft >= compactLayout.canvasLeft &&
      compactLayout.panelRight <= compactLayout.canvasRight + 4 &&
      compactLayout.panelTop >= compactLayout.canvasAreaTop - 2 &&
      compactLayout.panelBottom <= compactLayout.canvasAreaBottom + 2 &&
      compactLayout.canvasEngineWidth < compactLayout.canvasWidth - 4 &&
      compactLayout.canvasEngineRight <= compactLayout.panelLeft + 2,
    compactLayout ? JSON.stringify(compactLayout) : "compact inspector geometry not found"
  );
  await win.setViewportSize({ width: expandedLayout.viewportWidth, height: expandedLayout.viewportHeight });
  await waitForDrawerSettled(win);
  await win.getByTitle("Collapse properties").click();
  // The collapse glides over --awkit-dur-panel (240ms); waiting a fixed 220ms raced the animation and
  // sometimes measured the drawer still mid-collapse (~440px). Wait for the rail width to settle small.
  await win.waitForFunction(() => {
    const rail = document.querySelector(".properties-panel.collapsed");
    return rail ? rail.getBoundingClientRect().width <= 96 : false;
  }, undefined, { timeout: 4000 }).catch(() => {});
  const collapsedLayout = await win.evaluate(() => {
    const canvasEngine = document.querySelector(".react-flow-shell");
    const canvasArea = document.querySelector(".flow-designer-body");
    const rail = document.querySelector(".properties-panel.collapsed");
    if (!canvasEngine || !canvasArea || !rail) return null;
    const e = canvasEngine.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    return {
      canvasEngineWidth: e.width,
      bodyPaddingRight: parseFloat(getComputedStyle(canvasArea).paddingRight) || 0,
      railWidth: r.width,
      railHeight: r.height
    };
  });
  check(
    "Node Properties collapses from the open drawer to a compact rail",
    // Collapsed, the drawer becomes a compact docked rail (~48px = CSS calc(space-5*2)); the
    // meaningful signal is the rail shrinking far below the open drawer's width, not an exact
    // engine-width delta (the open drawer insets the engine — see awkit-73s above).
    collapsedLayout && expandedLayout && collapsedLayout.railWidth <= 96 &&
      collapsedLayout.railWidth < expandedLayout.panelWidth / 2,
    collapsedLayout ? JSON.stringify(collapsedLayout) : "collapsed rail not found"
  );

  // --- 3. Contextual Node Palette replaces the permanent side panel ---
  const legacyPaletteVisible = await win.locator(".flow-node-palette").isVisible().catch(() => false);
  check("Permanent Node Palette is not visible", !legacyPaletteVisible, `visible=${legacyPaletteVisible}`);
  await win.locator(".awkit-flow-canvas").click({ button: "right", position: { x: 120, y: 120 } });
  await win.waitForTimeout(250);
  const contextPicker = await win.locator('.canvas-item-picker[aria-label="Node Palette"]').isVisible().catch(() => false);
  const pickerCount = await win.locator('.canvas-item-picker [role="menuitem"]').count();
  check("Blank-canvas right click opens the searchable Node Palette", contextPicker && pickerCount > 10, `visible=${contextPicker} items=${pickerCount}`);

  // --- 4. Blank add creates a leaf node with an append "+", which reopens the palette ---
  await win.locator('.canvas-item-picker [role="menuitem"]').first().click();
  await win.waitForTimeout(300);
  const appendButton = win.locator(".node-append-affordance button").first();
  check("Blank-canvas add creates a leaf with an append +", await appendButton.isVisible().catch(() => false));
  await appendButton.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })));
  await win.waitForTimeout(250);
  check("Leaf + opens the same Node Palette", await win.locator('.canvas-item-picker[aria-label="Node Palette"]').isVisible().catch(() => false));
  await win.keyboard.press("Escape");

  // --- 5. Edge insert "+" opens the palette ---
  const insertBtn = win.locator(".awkit-edge-add").first();
  if (await insertBtn.isVisible().catch(() => false)) {
    await insertBtn.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })));
    await win.waitForTimeout(250);
    check("Edge insertion + opens the same Node Palette", await win.locator('.canvas-item-picker[aria-label="Node Palette"]').isVisible().catch(() => false));
    await win.keyboard.press("Escape");
  } else {
    check("Edge insertion + opens the same Node Palette", false, "SKIPPED: no insert + visible on this flow");
  }

  // --- 6. Loop toggle via the node kebab menu creates/removes a self-loop connector ---
  const NODE = await win.evaluate(() => {
    const node = [...document.querySelectorAll(".awkit-flow-node[data-id]")].find((n) => {
      const id = n.getAttribute("data-id") || "";
      return n.querySelector(".action-flow-node") && id !== "start" && id !== "end";
    });
    return node ? node.getAttribute("data-id") : null;
  });
  if (!NODE) {
    check("Add loop creates a self-loop connector", false, "no loopable action node found");
  } else {
    const before = await win.evaluate(() => document.querySelectorAll("g.awkit-flow-edge").length);
    await clickLoopMenuItem(win, NODE);
    await win.waitForTimeout(400);
    const loop = await win.evaluate((id) => {
      const self = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
      return { count: document.querySelectorAll("g.awkit-flow-edge").length, hasSelfLoop: Boolean(self && self.querySelector("path.awkit-flow-edge-path")) };
    }, NODE);
    check("Add loop creates a self-loop connector", loop.count === before + 1 && loop.hasSelfLoop, `before=${before} after=${loop.count} selfLoop=${loop.hasSelfLoop}`);

    const removeLabel = await loopItemLabel(win, NODE);
    check("Loop menu item toggled to a Remove control", removeLabel === "Remove loop", `label="${removeLabel}"`);

    await clickLoopMenuItem(win, NODE);
    await win.waitForTimeout(400);
    const after = await win.evaluate((id) => ({
      count: document.querySelectorAll("g.awkit-flow-edge").length,
      hasSelfLoop: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`))
    }), NODE);
    check("Removing the loop deletes the connector", !after.hasSelfLoop && after.count === before, `count=${after.count} (baseline ${before})`);
  }


  // --- 7. Real node-over-node drag opens the reference connection confirmation without a
  // rendering crash. Use hit-tested mouse input, not synthetic event dispatch.
  const dragPair = await win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas")?.getBoundingClientRect();
    if (!canvas) return null;
    const linked = new Set(
      [...document.querySelectorAll("g.awkit-flow-edge")].flatMap((edge) => {
        const source = edge.getAttribute("data-source");
        const target = edge.getAttribute("data-target");
        return source && target ? [`${source}->${target}`, `${target}->${source}`] : [];
      })
    );
    const nodes = [...document.querySelectorAll(".awkit-flow-node[data-id]")]
      .map((element) => {
        const id = element.getAttribute("data-id");
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (!id || rect.width <= 0 || rect.height <= 0 || x <= canvas.left || x >= canvas.right || y <= canvas.top || y >= canvas.bottom) return null;
        if (document.elementFromPoint(x, y)?.closest(".awkit-flow-node") !== element) return null;
        return { id, x, y };
      })
      .filter(Boolean);
    for (const source of nodes) {
      for (const target of nodes) {
        if (source.id !== target.id && !linked.has(`${source.id}->${target.id}`)) return { source, target };
      }
    }
    return null;
  });
  if (dragPair) {
    await win.mouse.move(dragPair.source.x, dragPair.source.y);
    await win.mouse.down();
    await win.mouse.move(dragPair.target.x, dragPair.target.y, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(260);
  }
  const connectDialog = await win.evaluate(() => {
    const dialog = document.querySelector(".modal-dialog-connect");
    if (!dialog) return null;
    const icon = dialog.querySelector(".modal-icon.connect")?.getBoundingClientRect();
    const body = dialog.querySelector(".modal-body")?.getBoundingClientRect();
    const buttons = [...dialog.querySelectorAll(".modal-actions button")].map((button) => (button.textContent || "").trim());
    const rect = dialog.getBoundingClientRect();
    return {
      title: dialog.querySelector("h2")?.textContent,
      width: rect.width,
      iconBeforeBody: Boolean(icon && body && icon.right < body.left),
      hasBranchIcon: Boolean(dialog.querySelector(".modal-icon.connect svg")),
      buttons
    };
  });
  check(
    "Dragging one step onto another opens the Connect these steps dialog",
    connectDialog?.title === "Connect these steps?" && pageErrors.length === 0 && !(await win.$(".error-boundary")),
    dragPair ? JSON.stringify(connectDialog) : "no unlinked visible node pair found"
  );
  check(
    "Connection dialog matches the branch-icon layout and Cancel / Connect arrangement",
    connectDialog && connectDialog.width >= 500 && connectDialog.iconBeforeBody && connectDialog.hasBranchIcon && connectDialog.buttons.join("|") === "Cancel|Connect",
    connectDialog ? JSON.stringify(connectDialog) : "dialog not found"
  );
  if (connectDialog) await win.getByRole("button", { name: "Cancel", exact: true }).click();

  // --- 8. Saved Flow searchable dropdown closes on an outside click over the canvas ---
  const trigger = await win.$(".searchable-select-trigger");
  if (!trigger) {
    check("Saved Flow dropdown closes on outside (canvas) click", false, "SKIPPED: no .searchable-select-trigger on this page");
  } else {
    await win.click(".searchable-select-trigger").catch(() => {});
    await win.waitForTimeout(200);
    const opened = Boolean(await win.$(".searchable-select-menu"));
    await win.evaluate(() => {
      const pane = document.querySelector(".awkit-flow-canvas") || document.body;
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    await win.waitForTimeout(200);
    const stillOpen = Boolean(await win.$(".searchable-select-menu"));
    check("Saved Flow dropdown opens, then closes on an outside canvas pointerdown", opened && !stillOpen, `opened=${opened} closedAfterCanvasClick=${!stillOpen}`);
  }

  // --- 9. Stage 2b: shared validation engine — draft save, chip, navigation, gate, library ---
  console.log("\nStage 2b: validation engine in the designer, library and run gate");

  // 9a. Reload the pristine valid flow (the walkthrough above mutated the canvas document) and
  // assert the chip derives "Runnable".
  await win.click(".searchable-select-trigger");
  await win.locator(".searchable-select-menu >> text=Verify — Flow Designer").first().click();
  await win.waitForTimeout(600);
  const chipRunnable = (await win.locator('[data-testid="flow-validation-chip"]').textContent().catch(() => "")) ?? "";
  check("Validation chip shows Runnable for the valid flow", chipRunnable.trim() === "Runnable", `chip="${chipRunnable.trim()}"`);

  // awkit-y24 / GUI check 11.3: configure the exact empty-result contract through the real Flow
  // Designer, save it, and read it back through the real preload/store boundary.
  await win.locator('.awkit-flow-node[data-id="click"]').click();
  await win.waitForTimeout(300);
  const showProperties = win.getByTitle("Show Node Properties");
  if (await showProperties.isVisible().catch(() => false)) {
    await showProperties.click();
    await win.waitForTimeout(320);
  }
  const asyncCompletion = win.locator("details.property-group", { hasText: "Async Completion" });
  if (!(await asyncCompletion.evaluate((element) => element.hasAttribute("open")).catch(() => false))) {
    await asyncCompletion.locator("summary").click();
  }
  // Change away and back so React emits the explicit allRequired value; merely selecting the
  // already-rendered default correctly produces no change event and leaves the field absent.
  await asyncCompletion.getByLabel("Completion policy").selectOption("anyRequired");
  await asyncCompletion.getByLabel("Completion policy").selectOption("allRequired");
  const afterAction = asyncCompletion.locator(".smart-wait-list", {
    has: win.locator(".smart-wait-list-heading strong", { hasText: "After action" })
  });
  await afterAction.locator(".smart-wait-list-heading").getByRole("button", { name: "API", exact: true }).click();
  await afterAction.locator(".smart-wait-list-heading").getByRole("button", { name: "OR group", exact: true }).click();
  await afterAction.locator(".smart-wait-list-heading").getByRole("button", { name: "Stream", exact: true }).click();

  const apiCard = afterAction.locator(":scope > .smart-wait-card", { hasText: /^Response/ });
  await apiCard.locator('input[placeholder="/api/orders"]').fill("/api/results");
  const groupCard = afterAction.locator(":scope > .smart-wait-card", { has: win.locator(".anyof-group") });
  await groupCard.locator('input[placeholder="#results"]').fill("#resultsTable");
  await groupCard.locator('input[placeholder="Saved successfully"]').fill("No invoices match the current filter.");
  const streamCard = afterAction.locator(":scope > .smart-wait-card", { hasText: /^Stream diagnostics/ });
  await streamCard.getByLabel("Transport").selectOption("sse");
  await streamCard.getByLabel("Observe").selectOption("open");
  await streamCard.locator('input[placeholder="/events or /ws"]').fill("/api/events");
  check(
    "GUI 4km exposes stream observation as diagnostic-only supporting evidence",
    ((await streamCard.textContent()) ?? "").includes("does not gate completion") &&
      ((await streamCard.textContent()) ?? "").includes("Diagnostic only")
  );
  const configuredGroup = await groupCard.evaluate((element) => ({
    branches: element.querySelectorAll(".anyof-branch").length,
    text: element.textContent ?? ""
  }));
  check(
    "GUI 11.3 exposes a required rows OR empty-state group with two editable branches",
    configuredGroup.branches === 2 &&
      configuredGroup.text.includes("Table rows") &&
      configuredGroup.text.includes("Text visible"),
    JSON.stringify(configuredGroup)
  );
  if (process.env.AWKIT_GROUPED_WAIT_EVIDENCE) {
    await win.screenshot({ path: process.env.AWKIT_GROUPED_WAIT_EVIDENCE });
  }

  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(600);
  const groupedFlow = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-flow-designer"));
  const groupedStep = groupedFlow?.nodes?.find((node) => node.id === "click");
  const persistedApi = groupedStep?.afterWaits?.find((wait) => wait.type === "response");
  const persistedGroup = groupedStep?.afterWaits?.find((wait) => wait.type === "anyOf");
  const persistedStream = groupedStep?.afterWaits?.find((wait) => wait.type === "streamActivity");
  check(
    "GUI 11.3 persists API AND (table rows OR empty-state text) without flattening",
    (groupedStep?.completionMode === undefined || groupedStep?.completionMode === "allRequired") &&
      persistedApi?.urlContains === "/api/results" &&
      persistedApi?.armBeforeAction === true &&
      persistedGroup?.conditions?.length === 2 &&
      persistedGroup.conditions[0]?.type === "tableHasRows" &&
      persistedGroup.conditions[0]?.tableLocator?.value === "#resultsTable" &&
      persistedGroup.conditions[1]?.type === "textVisible" &&
      persistedGroup.conditions[1]?.text === "No invoices match the current filter.",
    JSON.stringify(groupedStep?.afterWaits ?? null)
  );
  check(
    "GUI 4km persists SSE observation without promoting it to a completion gate",
    persistedStream?.transport === "sse" &&
      persistedStream?.event === "open" &&
      persistedStream?.urlContains === "/api/events" &&
      persistedStream?.diagnostics === "auto",
    JSON.stringify(persistedStream ?? null)
  );
  const collapseGroupedProperties = win.getByTitle("Collapse properties");
  if (await collapseGroupedProperties.isVisible().catch(() => false)) {
    await collapseGroupedProperties.click();
    await win.waitForTimeout(320);
  }

  // 9b. Switch to the seeded invalid draft via the Saved Flow dropdown. Re-open defensively —
  // the trigger click can race the popover dismiss from the selection just made in 9a.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await win.click(".searchable-select-trigger");
    await win.waitForTimeout(250);
    if (await win.locator(".searchable-select-menu").isVisible().catch(() => false)) break;
  }
  await win.locator(".searchable-select-menu >> text=Verify Invalid Draft").first().click({ timeout: 10_000 });
  await win.waitForTimeout(500);
  const chipDraft = (await win.locator('[data-testid="flow-validation-chip"]').textContent().catch(() => "")) ?? "";
  check("Validation chip flips to Draft — not runnable for the invalid draft", chipDraft.includes("not runnable"), `chip="${chipDraft.trim()}"`);

  // 9c. The chip opens the issue list, with blocking vs off-path badges.
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await win.locator('[data-testid="flow-validation-chip"]').evaluate((element) => element.click());
    await win.waitForTimeout(250);
    if (await win.locator('[data-testid="flow-validation-panel"]').isVisible().catch(() => false)) break;
  }
  const panelBadges = await win.evaluate(() => {
    const panel = document.querySelector('[data-testid="flow-validation-panel"]');
    if (!panel) return null;
    return [...panel.querySelectorAll(".validation-issue-badge")].map((badge) => (badge.textContent || "").trim());
  });
  check(
    "Issue panel lists both a blocking and an off-path finding",
    Array.isArray(panelBadges) && panelBadges.includes("blocks run") && panelBadges.includes("off-path"),
    JSON.stringify(panelBadges)
  );

  // 9d. Clicking an issue navigates to the offending node (structured location, not prose).
  await win.locator(".validation-issue-row", { hasText: "requires a locator" }).first().click();
  await win.waitForTimeout(400);
  const panelShowsNode = await win.evaluate(() => {
    const panel = document.querySelector(".properties-panel");
    return panel ? (panel.textContent || "").includes("Unlocated Click") : false;
  });
  check("Clicking the issue selects the offending node and opens its properties", panelShowsNode);

  // 9e. Save succeeds as a DRAFT and changes nothing in the graph.
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(600);
  const draftToast = await win.evaluate(() => document.querySelector(".app-toast-info")?.textContent ?? "");
  check("Saving the invalid flow succeeds with a Saved-as-draft notice", draftToast.includes("Saved as draft"), `toast="${draftToast}"`);
  const savedDraft = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-invalid-draft"));
  const draftNodeIds = (savedDraft?.nodes ?? []).map((node) => node.id).sort().join(",");
  const draftClick = (savedDraft?.nodes ?? []).find((node) => node.id === "click");
  check(
    "The saved draft still has every node — the orphan was NOT deleted, nothing was auto-fixed",
    draftNodeIds === "click,end,orphan,start" && draftClick && draftClick.locator === undefined,
    `nodes=${draftNodeIds} clickLocator=${JSON.stringify(draftClick?.locator ?? null)}`
  );
  const draftEdgeIds = (savedDraft?.edges ?? []).map((edge) => edge.id).sort().join(",");
  check("The saved draft keeps its connectors unchanged", draftEdgeIds === "e0,e1", `edges=${draftEdgeIds}`);

  // 9f. The run gate: fresh validation per run — blocking error rejects, off-path alone does not.
  const runInvalid = await win.evaluate(() => window.playwrightFlowStudio.executions.runWorkflow({ workflowId: "verify-wf-invalid", dryRun: true }));
  check(
    "runWorkflow on the invalid draft returns validationFailed with structured issues",
    runInvalid?.status === "validationFailed" &&
      runInvalid?.validation?.valid === false &&
      (runInvalid?.validation?.issues ?? []).some((issue) => issue.code === "missingRequiredLocator" && issue.nodeId === "click" && issue.blocking === true),
    JSON.stringify({ status: runInvalid?.status, issues: (runInvalid?.validation?.issues ?? []).map((i) => i.code) })
  );
  // Stage 2c: this flow has an ACTIVE-PATH error, so it is `immediately-blocked` by the inventory
  // scan and gets no grant — its off-path orphan therefore blocks too, while still being reported
  // as off the active path. (A grant only ever covers off-path-ONLY flows: see section 10.)
  check(
    "…and the off-path orphan is reported, classified off-path, and blocks without a grant",
    (runInvalid?.validation?.issues ?? []).some((issue) => issue.code === "unreachableNode" && issue.blocking === true && issue.onActivePath === false),
    JSON.stringify((runInvalid?.validation?.issues ?? []).filter((i) => i.code === "unreachableNode"))
  );
  const runValid = await win.evaluate(() => window.playwrightFlowStudio.executions.runWorkflow({ workflowId: "verify-wf-valid", dryRun: true }));
  check(
    "runWorkflow on the valid flow passes the gate despite the broken draft in the library (scoped validation)",
    runValid?.status === "validated",
    JSON.stringify({ status: runValid?.status, issues: (runValid?.validation?.issues ?? []).map((i) => i.code) })
  );

  // 9g. Flow Library: derived status with a real Checking… phase, never persisted.
  await win.evaluate(() => {
    window.__sawChecking = false;
    const record = () => {
      if (document.querySelector('[data-validation="checking"]')) window.__sawChecking = true;
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    record();
  });
  await navClick(win, "Flows");
  await win.waitForTimeout(900);
  const libraryPills = await win.evaluate(() => {
    const rows = [...document.querySelectorAll(".wl-table tbody tr")];
    const map = {};
    for (const row of rows) {
      const id = row.querySelectorAll("td")[1]?.textContent?.trim();
      const pill = row.querySelector("[data-validation]");
      if (id && pill) map[id] = pill.getAttribute("data-validation");
    }
    return { map, sawChecking: window.__sawChecking === true };
  });
  check("Library shows a Checking… phase before the derived verdict", libraryPills.sawChecking);
  check(
    "Library derives Runnable / Not runnable per flow from the engine",
    libraryPills.map["verify-flow-designer"] === "runnable" && libraryPills.map["verify-invalid-draft"] === "not-runnable",
    JSON.stringify(libraryPills.map)
  );
  const persistedDraft = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-invalid-draft"));
  check(
    "No runnable verdict is persisted onto the flow profile",
    persistedDraft && !("runnable" in persistedDraft) && !("validation" in persistedDraft) && !("validatedAt" in persistedDraft),
    Object.keys(persistedDraft ?? {}).join(",")
  );

  // --- 10. Stage 2c: Legacy Compatibility + suggested-fix migration ceremony ---
  console.log("\nStage 2c: Legacy Compatibility, inventory scan and safe-fix migration");

  // 10a. The inventory scan classifies the library and grants only the off-path-only flow.
  const scan = await win.evaluate(() => window.playwrightFlowStudio.validation.runInventoryScan());
  check(
    "Inventory scan groups the library by classification",
    scan?.counts?.valid >= 1 && scan?.counts?.["temporarily-compatible"] === 1 && scan?.counts?.["immediately-blocked"] >= 1,
    JSON.stringify(scan?.counts)
  );
  // The first run gate call already performed the initial scan (`ensureInventoryScan`), so this
  // explicit re-scan must NOT re-issue or extend anything — the deadline is the deadline.
  check("Re-scanning does not re-issue an existing grant", scan?.grantsIssued === 0, `issued=${scan?.grantsIssued}`);
  const grants = await win.evaluate(() => window.playwrightFlowStudio.validation.grants());
  check(
    "Exactly one grant exists, for the off-path-only flow, and it is time-limited",
    grants?.length === 1 && grants[0]?.id === "verify-zc-legacy-flow" && grants[0]?.expiresAt > grants[0]?.grantedAt,
    JSON.stringify(grants?.map((g) => g.id))
  );

  // 10b. The run gate honours the grant — and still blocks the active-path flow.
  const runLegacy = await win.evaluate(() => window.playwrightFlowStudio.executions.runWorkflow({ workflowId: "verify-wf-legacy", dryRun: true }));
  check("A granted flow passes the run gate", runLegacy?.status === "validated", JSON.stringify({ status: runLegacy?.status }));
  check(
    "…and the run is never silent: a Legacy Compatibility warning names the deadline",
    (runLegacy?.validation?.issues ?? []).some((issue) => issue.key?.startsWith("legacyCompatibility.") && issue.severity === "warning" && !issue.blocking),
    JSON.stringify((runLegacy?.validation?.issues ?? []).map((i) => i.key))
  );
  const runStillInvalid = await win.evaluate(() => window.playwrightFlowStudio.executions.runWorkflow({ workflowId: "verify-wf-invalid", dryRun: true }));
  check("An active-path error is still blocked after the scan", runStillInvalid?.status === "validationFailed");

  // 10c. Library shows the Legacy pill with its deadline, distinct from Runnable.
  await navClick(win, "Flows");
  await win.waitForTimeout(900);
  const pills = await win.evaluate(() => {
    const map = {};
    for (const row of document.querySelectorAll(".wl-table tbody tr")) {
      const id = row.querySelectorAll("td")[1]?.textContent?.trim();
      const pill = row.querySelector("[data-validation]");
      if (id && pill) map[id] = { state: pill.getAttribute("data-validation"), text: (pill.textContent || "").trim() };
    }
    return map;
  });
  check(
    "Library marks the granted flow as Legacy with its deadline",
    pills["verify-zc-legacy-flow"]?.state === "legacy-compatibility" && /Legacy · until \d{4}-\d{2}-\d{2}/.test(pills["verify-zc-legacy-flow"]?.text ?? ""),
    JSON.stringify(pills["verify-zc-legacy-flow"])
  );
  check("Library still marks the active-path flow Not runnable", pills["verify-invalid-draft"]?.state === "not-runnable", JSON.stringify(pills["verify-invalid-draft"]));
  check("Library still marks the clean flow Runnable", pills["verify-flow-designer"]?.state === "runnable", JSON.stringify(pills["verify-flow-designer"]));

  // 10d. Validate-on-load banner in the designer, and the fix ceremony.
  await navClick(win, "Flow Designer");
  await win.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await win.click(".searchable-select-trigger");
    await win.waitForTimeout(250);
    if (await win.locator(".searchable-select-menu").isVisible().catch(() => false)) break;
  }
  await win.locator(".searchable-select-menu >> text=Verify Legacy Flow").first().click({ timeout: 10_000 });
  await win.waitForTimeout(700);
  const legacyBanner = await win.evaluate(() => document.querySelector('[data-testid="flow-validation-banner"]')?.textContent ?? "");
  check("Opening a granted flow shows the Legacy Compatibility banner with its deadline", /Legacy Compatibility/.test(legacyBanner) && /\d{4}-\d{2}-\d{2}/.test(legacyBanner), `banner="${legacyBanner.slice(0, 120)}"`);
  const legacyUnchanged = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-zc-legacy-flow"));
  check("Opening a legacy flow does NOT modify or save it", (legacyUnchanged?.nodes ?? []).some((node) => node.id === "orphan") && legacyUnchanged?.updatedAt === legacyUnchanged?.createdAt);

  // 10e. Suggested fix: preview → confirm → apply → undo, on the fixable flow.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await win.click(".searchable-select-trigger");
    await win.waitForTimeout(250);
    if (await win.locator(".searchable-select-menu").isVisible().catch(() => false)) break;
  }
  await win.locator(".searchable-select-menu >> text=Verify Fixable Flow").first().click({ timeout: 10_000 });
  await win.waitForTimeout(700);
  const beforeFix = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-zc-fixable-flow"));
  check("The fixable flow offers a Fix safe issues action", await win.locator('[data-testid="flow-fix-safe-issues"]').isVisible().catch(() => false));

  await win.click('[data-testid="flow-fix-safe-issues"]');
  await win.waitForTimeout(500);
  const previewText = await win.evaluate(() => document.querySelector('[data-testid="flow-fix-preview"]')?.textContent ?? "");
  check(
    "A change preview lists each schema fix before anything is written",
    /NotEquals/.test(previewText) && /notEquals/.test(previewText) && /Outcome/.test(previewText),
    `preview="${previewText.slice(0, 160)}"`
  );
  const duringPreview = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-zc-fixable-flow"));
  check("Showing the preview writes nothing", JSON.stringify(duringPreview) === JSON.stringify(beforeFix));

  await win.click('[data-testid="flow-fix-confirm"]');
  await win.waitForTimeout(900);
  const afterFix = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-zc-fixable-flow"));
  const fixedEdge = (afterFix?.edges ?? []).find((edge) => edge.id === "e-cond");
  check("Confirming applies the normalization", fixedEdge?.conditional?.operator === "notEquals" && fixedEdge?.conditional?.sourceField === "outcome", JSON.stringify(fixedEdge?.conditional));
  check(
    "…and changes nothing else about the flow",
    (afterFix?.nodes ?? []).length === (beforeFix?.nodes ?? []).length && (afterFix?.edges ?? []).length === (beforeFix?.edges ?? []).length
  );
  const migrations = await win.evaluate(() => window.playwrightFlowStudio.validation.migrations("verify-zc-fixable-flow"));
  check("A migration report was recorded", migrations?.length === 1 && migrations[0]?.fixes?.length === 2, JSON.stringify(migrations?.map((m) => m.fixes?.length)));

  check("An undo control is offered after the migration", await win.locator('[data-testid="flow-migration-undo"]').isVisible().catch(() => false));
  await win.locator('[data-testid="flow-migration-undo"] >> text=Undo migration').click();
  await win.waitForTimeout(900);
  const afterUndo = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-zc-fixable-flow"));
  const undoneEdge = (afterUndo?.edges ?? []).find((edge) => edge.id === "e-cond");
  check("Undo restores the original document", undoneEdge?.conditional?.operator === "NotEquals" && undoneEdge?.conditional?.sourceField === "Outcome", JSON.stringify(undoneEdge?.conditional));

  // --- 10. Increment 3/4: the real properties UI persists, invalidates and revokes approval. ---
  console.log("\nIncrements 3/4: Flow Designer locator approval lifecycle");
  await win.click(".searchable-select-trigger");
  await win.locator(".searchable-select-menu >> text=Verify Positional Approval").first().click();
  await win.waitForTimeout(600);
  await win.keyboard.press("Escape");
  const positionalNode = win.locator('.awkit-flow-node[data-id="positional"]');
  await positionalNode.dispatchEvent("pointerdown", { pointerId: 1, clientX: 1, clientY: 1 });
  await positionalNode.dispatchEvent("pointerup", { pointerId: 1, clientX: 1, clientY: 1 });
  await win.waitForTimeout(300);
  const showLocatorProperties = win.getByTitle("Show Node Properties");
  if (await showLocatorProperties.isVisible().catch(() => false)) {
    await showLocatorProperties.click();
    await win.waitForTimeout(320);
  }
  const locatorReview = win.getByTestId("locator-review-state");
  check("Flow Designer displays the unresolved positional locator", /Needs element identity proof.*execution blocked/.test((await locatorReview.textContent()) ?? ""));
  const approveLocator = win.getByTestId("approve-locator-fallback");
  check("Flow Designer requires a reason before approval", await approveLocator.isDisabled());
  await locatorReview.getByLabel("Approval reason").fill("Reviewed: fixture is intentionally position-only.");
  check("Flow Designer enables explicit approval after a reason", await approveLocator.isEnabled());
  await approveLocator.focus();
  await win.keyboard.press("Enter");
  check("Flow Designer displays approved-fallback state", /User-approved fallback/.test((await locatorReview.textContent()) ?? ""));
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(700);
  const approvedProfile = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-positional-approval"));
  const approvedNode = approvedProfile?.nodes?.find((node) => node.id === "positional");
  check(
    "Flow Designer save persists approval reason and exact binding",
    approvedNode?.locator?.resolution === "user-approved-fallback" &&
      approvedNode?.locator?.approvedFallbackReason === "Reviewed: fixture is intentionally position-only." &&
      approvedNode?.locator?.approvedFallbackBinding?.version === 1,
    JSON.stringify(approvedNode?.locator)
  );

  await win.getByLabel("Value", { exact: true }).fill(".pos-btn >> nth=0");
  check("Editing the locator immediately invalidates stale approval", /Needs element identity proof.*execution blocked/.test((await locatorReview.textContent()) ?? ""));
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(700);
  const editedProfile = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-positional-approval"));
  const editedNode = editedProfile?.nodes?.find((node) => node.id === "positional");
  check(
    "The invalidated approval is absent after save/reload",
    editedNode?.locator?.resolution === "needs-review" &&
      !editedNode?.locator?.approvedFallbackReason &&
      !editedNode?.locator?.approvedFallbackBinding,
    JSON.stringify(editedNode?.locator)
  );

  await locatorReview.getByLabel("Approval reason").fill("Reviewed again after the locator edit.");
  await win.getByTestId("approve-locator-fallback").focus();
  await win.keyboard.press("Enter");
  await win.getByTestId("revoke-locator-fallback").focus();
  await win.keyboard.press("Enter");
  check("Revoking approval returns the locator to review-required", /Needs element identity proof.*execution blocked/.test((await locatorReview.textContent()) ?? ""));
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(700);
  const revokedProfile = await win.evaluate(() => window.playwrightFlowStudio.flows.get("verify-positional-approval"));
  const revokedNode = revokedProfile?.nodes?.find((node) => node.id === "positional");
  check("Revoked approval remains blocked after save/reload", revokedNode?.locator?.resolution === "needs-review" && !revokedNode?.locator?.approvedFallbackBinding, JSON.stringify(revokedNode?.locator));

  // awkit-x48: a rejected IPC call must reach the renderer as the handler's own sentence, not
  // wrapped in Electron's `Error invoking remote method '<channel>': ` preamble. Unit coverage lives
  // in verify:ipc-error-message; this proves the preload boundary is actually wired in the REAL app,
  // over the very channel that reported the defect. Undoing a migration that does not exist is a
  // pure refusal — it touches no stored flow.
  const ipcRejection = await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.validation.undoMigration("awkit-x48-no-such-flow", "no-such-migration");
      return { rejected: false, message: "" };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  check("A failing IPC call still rejects in the real app", ipcRejection.rejected, JSON.stringify(ipcRejection));
  check(
    "The rejection message does not leak the IPC channel name",
    ipcRejection.rejected &&
      !ipcRejection.message.includes("Error invoking remote method") &&
      !ipcRejection.message.includes("validation:undoMigration"),
    ipcRejection.message
  );
  check(
    "The rejection still carries a non-empty domain message",
    ipcRejection.message.trim().length > 0,
    ipcRejection.message
  );

  // --- 11. Shared Unsaved Changes dialog alignment, focus order, responsive behavior and actions. ---
  const dirtyNameInput = win.locator('label:has-text("Flow Name") input');
  await dirtyNameInput.fill(`${await dirtyNameInput.inputValue()} dialog check`);
  await win.waitForTimeout(380);
  await win.click('button.nav-item:has-text("Reports")').catch(async () => win.click('button.nav-item[title="Reports"]'));
  const unsavedDialog = win.getByRole("alertdialog");
  await unsavedDialog.waitFor({ state: "visible" });
  const desktopActions = await unsavedDialog.evaluate((dialog) => {
    const buttons = [...dialog.querySelectorAll(".unsaved-changes-actions button")];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const shell = dialog.getBoundingClientRect();
    return {
      labels: buttons.map((button) => button.textContent?.trim()),
      sameBaseline: rects.every((rect) => Math.abs(rect.bottom - rects[0].bottom) <= 1),
      noOverlap: rects.every((rect, index) => index === 0 || rect.left >= rects[index - 1].right),
      contained: rects.every((rect) => rect.left >= shell.left && rect.right <= shell.right)
    };
  });
  check("Unsaved dialog actions share one desktop baseline without overlap", desktopActions.sameBaseline && desktopActions.noOverlap && desktopActions.contained, JSON.stringify(desktopActions));
  check("Unsaved dialog action order is Cancel, Discard, Save", desktopActions.labels.join("|") === "Cancel|Discard Changes|Save and Continue", JSON.stringify(desktopActions.labels));
  check("Unsaved dialog initially focuses Cancel", await unsavedDialog.getByRole("button", { name: "Cancel" }).evaluate((button) => button === document.activeElement));
  await win.keyboard.press("Tab");
  check("Unsaved dialog Tab order reaches Discard second", await unsavedDialog.getByRole("button", { name: "Discard Changes" }).evaluate((button) => button === document.activeElement));
  await win.keyboard.press("Tab");
  check("Unsaved dialog Tab order reaches Save third", await unsavedDialog.getByRole("button", { name: "Save and Continue" }).evaluate((button) => button === document.activeElement));
  await win.keyboard.press("Escape");
  await unsavedDialog.waitFor({ state: "hidden" });
  check("Escape cancels navigation and keeps the current page", Boolean(await win.$(".flow-designer-shell")));

  await win.setViewportSize({ width: 420, height: 760 });
  await win.click('button.nav-item:has-text("Reports")').catch(async () => win.click('button.nav-item[title="Reports"]'));
  await unsavedDialog.waitFor({ state: "visible" });
  const narrowActions = await unsavedDialog.evaluate((dialog) => {
    const buttons = [...dialog.querySelectorAll(".unsaved-changes-actions button")];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const shell = dialog.getBoundingClientRect();
    return {
      stacked: rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom),
      contained: rects.every((rect) => rect.left >= shell.left && rect.right <= shell.right && rect.top >= shell.top && rect.bottom <= shell.bottom)
    };
  });
  check("Unsaved dialog intentionally stacks without overflow at narrow width", narrowActions.stacked && narrowActions.contained, JSON.stringify(narrowActions));
  await unsavedDialog.getByRole("button", { name: "Discard Changes" }).click();
  await win.waitForSelector(".reports-page", { timeout: 10000 }).catch(() => undefined);
  check("Discard navigates away without saving", !await win.$(".flow-designer-shell"));

  await win.setViewportSize({ width: 1280, height: 800 });
  await win.click('button.nav-item:has-text("Flow Designer")').catch(async () => win.click('button.nav-item[title="Flow Designer"]'));
  await win.waitForSelector(".flow-designer-shell", { timeout: 10000 });
  const saveContinueInput = win.locator('label:has-text("Flow Name") input');
  const saveContinueName = `${await saveContinueInput.inputValue()} saved before leave`;
  await saveContinueInput.fill(saveContinueName);
  await win.waitForTimeout(380);
  await win.click('button.nav-item:has-text("Reports")').catch(async () => win.click('button.nav-item[title="Reports"]'));
  await win.getByRole("alertdialog").getByRole("button", { name: "Save and Continue" }).click();
  await win.waitForTimeout(800);
  const persistedAfterLeave = await win.evaluate(async (name) => (await window.playwrightFlowStudio.flows.list()).some((flow) => flow.name === name), saveContinueName);
  check("Save and Continue persists then navigates", persistedAfterLeave && !await win.$(".flow-designer-shell"));

  check("Flow Designer walkthrough emits no renderer console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors));

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
