// Real GUI walkthrough of the Flow Designer canvas.
//
// Launches the actual built Electron app (main + preload + renderer) via Playwright's
// _electron API and drives the Flow Designer, asserting on the real rendered DOM/SVG. The
// canvas now runs on the in-house engine (app/renderer/components/canvas) — no React Flow —
// so this exercises the engine's DOM: `.awkit-flow-node[data-id]` cards, `g.awkit-flow-edge`
// connectors, the contextual Node Palette, the append/insert "+" affordances, and the
// kebab-menu loop toggle. Branch-port geometry checks were removed with the port model.
//
// Run: node scripts/verify-flow-designer-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // must run as a GUI app, not plain Node

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
      toolbarRight: t.right,
      panelLeft: p.left,
      panelTop: p.top,
      panelRight: p.right,
      panelBottom: p.bottom,
      panelWidth: p.width
    };
  });
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
  const win = await app.firstWindow();
  const pageErrors = [];
  const consoleErrors = [];
  win.on("pageerror", (error) => pageErrors.push(error.message));
  win.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await win.waitForLoadState("domcontentloaded");

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

  // --- 2b. The properties inspector stays inside the full-width designer canvas while the usable
  // canvas body reserves room for it, then returns that room when the inspector collapses. ---
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
  // The canvas inset now glides open over --awkit-dur-panel (240ms, docs §9.1). Measure at rest,
  // after the glide settles, so the panel-vs-canvas geometry reflects the final layout, not a frame
  // mid-animation (the at-rest invariant canvasEngineRight <= panelLeft is what the checks assert).
  await win.waitForTimeout(360);
  const expandedLayout = await readInspectorGeometry(win);
  check(
    "Node Properties is contained inside the full-width designer canvas and toolbar",
    Boolean(inspectablePoint) && expandedLayout &&
      Math.abs(expandedLayout.canvasWidth - fullHeightLayout.canvasWidth) <= 1 &&
      Math.abs(expandedLayout.toolbarRight - expandedLayout.canvasRight) <= 1 &&
      expandedLayout.panelLeft >= expandedLayout.canvasLeft &&
      expandedLayout.panelRight <= expandedLayout.canvasRight,
    expandedLayout ? JSON.stringify(expandedLayout) : "no hit-testable node or inspector did not open"
  );
  check(
    "Node Properties stays within the vertical canvas area below the toolbar without covering the usable canvas",
    expandedLayout &&
      Math.abs(expandedLayout.panelTop - expandedLayout.canvasAreaTop) <= 1 &&
      expandedLayout.panelBottom <= expandedLayout.canvasAreaBottom + 1 &&
      expandedLayout.canvasEngineRight <= expandedLayout.panelLeft,
    expandedLayout ? JSON.stringify(expandedLayout) : "inspector geometry not found"
  );
  await win.setViewportSize({ width: 1936, height: 1290 });
  await win.waitForTimeout(180);
  const wideLayout = await readInspectorGeometry(win);
  check(
    "Node Properties remains inside the canvas at the reported 1936x1290 viewport",
    wideLayout &&
      wideLayout.viewportWidth === 1936 && wideLayout.viewportHeight === 1290 &&
      Math.abs(wideLayout.toolbarRight - wideLayout.canvasRight) <= 1 &&
      wideLayout.panelLeft >= wideLayout.canvasLeft &&
      wideLayout.panelRight <= wideLayout.canvasRight &&
      Math.abs(wideLayout.panelTop - wideLayout.canvasAreaTop) <= 1 &&
      wideLayout.panelBottom <= wideLayout.canvasAreaBottom + 1 &&
      wideLayout.canvasEngineRight <= wideLayout.panelLeft,
    wideLayout ? JSON.stringify(wideLayout) : "wide inspector geometry not found"
  );
  if (process.env.AWKIT_FLOW_DESIGNER_EVIDENCE) {
    await win.screenshot({ path: process.env.AWKIT_FLOW_DESIGNER_EVIDENCE });
  }
  await win.setViewportSize({ width: 1024, height: 768 });
  await win.waitForTimeout(180);
  const compactLayout = await readInspectorGeometry(win);
  check(
    "Node Properties remains inside the canvas when the toolbar wraps at a compact viewport",
    compactLayout &&
      compactLayout.viewportWidth === 1024 && compactLayout.viewportHeight === 768 &&
      Math.abs(compactLayout.toolbarRight - compactLayout.canvasRight) <= 1 &&
      compactLayout.panelLeft >= compactLayout.canvasLeft &&
      compactLayout.panelRight <= compactLayout.canvasRight &&
      Math.abs(compactLayout.panelTop - compactLayout.canvasAreaTop) <= 1 &&
      compactLayout.panelBottom <= compactLayout.canvasAreaBottom + 1 &&
      compactLayout.canvasEngineRight <= compactLayout.panelLeft,
    compactLayout ? JSON.stringify(compactLayout) : "compact inspector geometry not found"
  );
  await win.setViewportSize({ width: expandedLayout.viewportWidth, height: expandedLayout.viewportHeight });
  await win.waitForTimeout(180);
  await win.getByTitle("Collapse properties").click();
  await win.waitForTimeout(220);
  const collapsedLayout = await win.evaluate(() => {
    const canvasEngine = document.querySelector(".react-flow-shell");
    const rail = document.querySelector(".properties-panel.collapsed");
    if (!canvasEngine || !rail) return null;
    const e = canvasEngine.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    return { canvasEngineWidth: e.width, railWidth: r.width, railHeight: r.height };
  });
  check(
    "Node Properties collapses to a compact rail and returns space to the canvas",
    collapsedLayout && expandedLayout && collapsedLayout.railWidth <= 64 &&
      collapsedLayout.canvasEngineWidth > expandedLayout.canvasEngineWidth,
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

  check("Flow Designer walkthrough emits no renderer console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} GUI checks passed`);
  await app.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error("GUI walkthrough error:", err);
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  process.exit(2);
}
