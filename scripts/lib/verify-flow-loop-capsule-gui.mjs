import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
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
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./gui-verify-harness.mjs";

export const FLOW_LOOP_CAPSULE_CHECK_NAMES = Object.freeze([
  "Flow Loop default renders the approved capsule, dominant ring, configured value, and sweep",
  "Flow Loop capsule oracle rejects the superseded U-route hybrid",
  "Flow Loop dense-layout scoring chooses the clear side and fit keeps the complete control visible",
  "Flow Loop configuration preserves exact authored value, style, and mode-aware label",
  "Flow Loop attachment is a compact same-side capsule rather than bottom-to-top full-node routing",
  "Flow Loop renders the authored dotted width and rotates only the circular sweep while value and label remain stationary",
  "Flow Loop reduced-motion contract freezes the sweep without hiding the value or capsule",
  "Flow Loop capsule remains attached with stable motion through 25%, 100%, 200% zoom and canvas pan",
  "Dragging the Flow node keeps the capsule, dominant ring, value, and attachment geometry together",
  "Two Flow Loops retain independent identities, values, labels, selection, and normal sweep motion",
  "Reduced motion freezes both independent Flow sweeps without hiding either value or label",
  "Flow Loop first save preserves authored configuration, style, and exactly one promoted Conditional exit",
  "Flow Loop reload, config Undo/Redo, and second reconfigure/save/reload preserve the exact capsule state",
  "Flow Loop direct target and Delete/Undo/Redo restore its exact authored state",
  "Undo restores an inspector-deleted Flow Loop with its exact capsule state",
  "Flow Loop configuration remains accessible by pointer, double-click, Enter, and Space"
]);

export function matchesFlowLoopCapsuleCheckContract(results) {
  if (!Array.isArray(results) || results.length !== FLOW_LOOP_CAPSULE_CHECK_NAMES.length) return false;
  const actualNames = results.map((result) => result?.name);
  return new Set(actualNames).size === FLOW_LOOP_CAPSULE_CHECK_NAMES.length &&
    actualNames.every((name, index) => name === FLOW_LOOP_CAPSULE_CHECK_NAMES[index]);
}

const normalizeDash = (value) => String(value ?? "")
  .replace(/px|,/g, " ")
  .trim()
  .replace(/\s+/g, " ");

function seedFlow(dataRoot) {
  const now = new Date().toISOString();
  const flowsDir = path.join(dataRoot, "SpecterStudio", "flows");
  mkdirSync(flowsDir, { recursive: true });
  const flow = {
    id: "verify-flow-loop-capsule",
    name: "Verify — Flow Loop Capsule",
    description: "Focused capsule-and-ring Loop contract fixture.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 320, y: 80 } },
      { id: "left-blocker", type: "goto", name: "Dense left blocker", url: "about:blank", valueSource: { type: "static", value: "about:blank" }, position: { x: -100, y: 220 } },
      { id: "goto", type: "goto", name: "Open Page", url: "http://localhost:4321/", valueSource: { type: "static", value: "http://localhost:4321/" }, position: { x: 320, y: 220 } },
      { id: "fill", type: "fill", name: "Fill", locator: { strategy: "id", value: "username" }, valueSource: { type: "static", value: "user1" }, position: { x: 320, y: 360 } },
      { id: "click", type: "click", name: "Click", locator: { strategy: "id", value: "loginButton" }, position: { x: 320, y: 500 } },
      { id: "end", type: "end", name: "End", position: { x: 320, y: 640 } }
    ],
    edges: [
      { id: "e0", source: "start", target: "left-blocker", type: "success" },
      { id: "e0b", source: "left-blocker", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "fill", type: "success" },
      { id: "e2", source: "fill", target: "click", type: "success" },
      { id: "e3", source: "click", target: "end", type: "success" }
    ]
  };
  writeFileSync(path.join(flowsDir, `${flow.id}.json`), `${JSON.stringify(flow, null, 2)}\n`, "utf8");
}

async function clickNodeMenuItem(win, nodeId, label) {
  const node = win.locator(`.awkit-flow-node[data-id="${nodeId}"]`);
  await node.locator(".action-node-menu").click();
  const menuItem = win.locator(".node-options-menu .node-options-item", { hasText: label }).filter({ hasText: new RegExp(`^${label}$`, "i") });
  await menuItem.first().waitFor({ state: "visible" });
  await menuItem.first().click();
}

async function selectSavedFlow(win, name) {
  await win.locator('button.searchable-select-trigger[aria-label="Saved flow"]').click();
  await win.locator(".searchable-select-menu", { hasText: name }).waitFor({ state: "visible" });
  await win.locator(`.searchable-select-menu >> text=${name}`).first().click();
  await win.locator('.awkit-flow-node[data-id="goto"]').waitFor({ state: "visible" });
}

async function waitForLoop(win, nodeId, present = true) {
  await win.waitForFunction(({ id, expected }) => Boolean(document.querySelector(
    `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator`
  )) === expected, { id: nodeId, expected: present }, { polling: 100 });
}

async function waitForConfiguredValue(win, nodeId, value) {
  await win.waitForFunction(({ id, expected }) => {
    const text = document.querySelector(
      `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-value`
    );
    return (text?.textContent ?? "").trim() === expected;
  }, { id: nodeId, expected: String(value) }, { polling: 100 });
}

async function waitForHistoryControl(win, testId) {
  await win.waitForFunction((id) => {
    const control = document.querySelector(`[data-testid="${CSS.escape(id)}"]`);
    return control instanceof HTMLButtonElement && !control.disabled;
  }, testId, { polling: 100 });
}

async function ensureLoopConfigVisible(win, nodeId, control) {
  if (await control.isVisible().catch(() => false)) return;
  await win.locator(
    `g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`
  ).click();
  await control.waitFor({ state: "visible" });
}

async function findEmptyCanvasPoint(win) {
  return win.evaluate(() => {
    const canvas = document.querySelector(".awkit-flow-canvas");
    if (!(canvas instanceof HTMLElement)) return null;
    const rect = canvas.getBoundingClientRect();
    for (let y = rect.top + 32; y < rect.bottom - 32; y += 28) {
      for (let x = rect.left + 32; x < rect.right - 32; x += 28) {
        const element = document.elementFromPoint(x, y);
        if (!element || element.closest(
          '[data-canvas-node], g.awkit-flow-edge, .awkit-flow-edge-labels, button, input, select, textarea, a, [role="dialog"]'
        )) continue;
        return { x, y };
      }
    }
    return null;
  });
}

async function fitAndStabilize(win, nodeIds) {
  await win.locator('.canvas-zoom-control button[title="Fit to screen"]').click();
  return Promise.all(nodeIds.map((nodeId) => waitForLoopCapsuleLayoutStable(win, nodeId)));
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

export async function runFlowLoopCapsuleSuite(root) {
  const results = [];
  const check = (name, pass, detail) => {
    const expectedName = FLOW_LOOP_CAPSULE_CHECK_NAMES[results.length];
    const nameMatches = name === expectedName;
    const passed = Boolean(pass) && nameMatches;
    const resolvedDetail = nameMatches
      ? detail
      : `focused check contract mismatch: expected ${JSON.stringify(expectedName)}, received ${JSON.stringify(name)}${detail ? `; ${detail}` : ""}`;
    results.push({ name, pass: passed, detail: resolvedDetail });
    console.log(`${passed ? "  ✓" : "  ✗"} ${name}${resolvedDetail ? ` — ${resolvedDetail}` : ""}`);
  };
  const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-flow-loop-capsule-gui");
  seedFlow(dataRoot);
  const app = await electron.launch({ args: [root, `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`], cwd: root, env });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);
    await win.emulateMedia({ reducedMotion: "no-preference" });
    await win.setViewportSize({ width: 1440, height: 900 });
    if (!(await win.$(".flow-designer-shell"))) {
      await win.locator('button.nav-item:has-text("Flow Designer")').click();
    }
    await win.locator(".flow-designer-shell").waitFor({ state: "visible" });
    await selectSavedFlow(win, "Verify — Flow Loop Capsule");

    const nodeId = "goto";
    await fitNodeActionIntoView(win, nodeId);
    await clickNodeMenuItem(win, nodeId, "Add loop");
    await waitForLoop(win, nodeId);
    const loopMode = win.locator('.connection-config-drawer label:has-text("Loop mode") select');
    const maxIterations = win.locator('.connection-config-drawer label:has-text("Max iterations") input');
    const lineStyle = win.locator('.connection-config-drawer label:has-text("Line style") select');
    const thickness = win.locator('.connection-config-drawer label:has-text("Thickness") select');
    const connectorShape = win.locator('.connection-config-drawer label:has-text("Connector shape") select');
    await loopMode.waitFor({ state: "visible" });
    await waitForConfiguredValue(win, nodeId, 3);
    const initialStable = await fitAndStabilize(win, [nodeId]);
    const defaultVisual = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Flow Loop default renders the approved capsule, dominant ring, configured value, and sweep",
      matchesLoopCapsuleContract(defaultVisual, { owner: nodeId, value: 3 }) && defaultVisual?.labelText === "Count × 3",
      JSON.stringify(defaultVisual)
    );
    check(
      "Flow Loop capsule oracle rejects the superseded U-route hybrid",
      rejectsLoopURouteHybrid(defaultVisual),
      JSON.stringify({ visualContract: defaultVisual?.visualContract, laneCount: defaultVisual?.laneCount, directionCount: defaultVisual?.directionCount, pathWrapsWholeNode: defaultVisual?.pathWrapsWholeNode })
    );
    check(
      "Flow Loop dense-layout scoring chooses the clear side and fit keeps the complete control visible",
      initialStable.every(Boolean) && defaultVisual?.side === "right" && defaultVisual.ringFullyVisible &&
        defaultVisual.controlFullyVisible && !defaultVisual.overlapsOtherNode && !defaultVisual.overlapsInsertControl,
      JSON.stringify({ initialStable, defaultVisual })
    );

    await loopMode.selectOption("whileCondition");
    await maxIterations.fill("10");
    await lineStyle.selectOption("dotted");
    await thickness.selectOption("4");
    await connectorShape.selectOption("smoothstep");
    await waitForConfiguredValue(win, nodeId, 10);

    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const visual = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Flow Loop configuration preserves exact authored value, style, and mode-aware label",
      matchesLoopCapsuleContract(visual, { owner: nodeId, value: 10 }) &&
        visual?.labelText === "While · status = passed" &&
        await loopMode.inputValue() === "whileCondition" && await maxIterations.inputValue() === "10" &&
        await lineStyle.inputValue() === "dotted" && await thickness.inputValue() === "4" && await connectorShape.inputValue() === "smoothstep" &&
        normalizeDash(visual.pathStrokeDash) === "1 5" && Number.parseFloat(visual.pathStrokeWidth) === 4 &&
        !/\b\d+\s*\/\s*\d+\b|\biteration\b/i.test(visual?.ariaLabel ?? ""),
      JSON.stringify(visual)
    );
    check(
      "Flow Loop attachment is a compact same-side capsule rather than bottom-to-top full-node routing",
      visual?.laneAttachedToNode && visual.sameSideAttachment && visual.capsulePathIsCompact &&
        !visual.pathWrapsWholeNode && visual.markerOutsideNode && visual.directionCount === 0 && visual.arrowCount === 0,
      JSON.stringify(visual)
    );

    const motion = await readLoopCapsuleMotion(win, nodeId);
    const pixelMotion = await readLoopCapsulePixelMotion(win, nodeId);
    check(
      "Flow Loop renders the authored dotted width and rotates only the circular sweep while value and label remain stationary",
      visual?.animationName === "awkit-loop-control-orbit" && visual.animationIterationCount === "infinite" &&
        visual.animationTimingFunction === "linear" && Number.parseFloat(visual.animationDuration) === 2 && visual.sweepAnimationCount === 1 &&
        visual.sweepPathLength === "100" && normalizeDash(visual.sweepDash) === "22 78" &&
        normalizeDash(visual.pathStrokeDash) === "1 5" && Number.parseFloat(visual.pathStrokeWidth) === 4 &&
        visual.pathStrokeLinecap === "round" && visual.pathStrokeLinejoin === "round" &&
        Number.parseFloat(visual.sweepWidth) === 4 && motion?.moved && Number.isFinite(motion.delta) && motion.delta >= 100 &&
        !motion.valueMoved && !motion.labelMoved && motion.valueAnimationCount === 0 && motion.labelAnimationCount === 0 &&
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
      "Flow Loop reduced-motion contract freezes the sweep without hiding the value or capsule",
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
    const emptyCanvasPoint = await findEmptyCanvasPoint(win);
    let panMoved = false;
    if (emptyCanvasPoint && beforePan) {
      await win.mouse.move(emptyCanvasPoint.x, emptyCanvasPoint.y);
      await win.mouse.down();
      await win.mouse.move(emptyCanvasPoint.x + 48, emptyCanvasPoint.y + 32, { steps: 6 });
      await win.mouse.up();
      panMoved = await win.waitForFunction(({ id, left, top }) => {
        const node = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(id)}"]`);
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        return Math.hypot(rect.left - left, rect.top - top) >= 20;
      }, { id: nodeId, left: beforePan.nodeLeft, top: beforePan.nodeTop }).then(() => true).catch(() => false);
    }
    const panStable = await waitForLoopCapsuleLayoutStable(win, nodeId);
    const afterPan = await readLoopCapsuleVisual(win, nodeId);
    const restoredAfterPan = await fitAndStabilize(win, [nodeId]);
    const afterPanRestore = await readLoopCapsuleVisual(win, nodeId);
    const zoomAnimationStartTime = at100.visual?.sweepAnimationStartTime;
    check(
      "Flow Loop capsule remains attached with stable motion through 25%, 100%, 200% zoom and canvas pan",
      at25.percent === 25 && at100.percent === 100 && at200.percent === 200 &&
        [at25, at100, at200].every((sample) => sample.stable && matchesLoopCapsuleContract(sample.visual, { owner: nodeId, value: 10 }) &&
          sample.visual.laneAttachedToNode && sample.visual.sameSideAttachment && !sample.visual.pathWrapsWholeNode &&
          Number.isFinite(sample.visual.sweepAnimationStartTime) && sample.visual.sweepAnimationStartTime === zoomAnimationStartTime) &&
        Boolean(emptyCanvasPoint) && panMoved && panStable && restoredAfterPan.every(Boolean) &&
        loopCapsuleMovedWithNode(beforePan, afterPan) && matchesLoopCapsuleContract(afterPan, { owner: nodeId, value: 10 }) &&
        matchesLoopCapsuleContract(afterPanRestore, { owner: nodeId, value: 10 }) &&
        afterPan?.sweepAnimationStartTime === beforePan?.sweepAnimationStartTime &&
        afterPanRestore?.sweepAnimationStartTime === beforePan?.sweepAnimationStartTime,
      JSON.stringify({ at25, at100, at200, emptyCanvasPoint, panMoved, panStable, beforePan, afterPan, restoredAfterPan, afterPanRestore })
    );

    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const beforeDrag = await readLoopCapsuleVisual(win, nodeId);
    const nodeBox = await win.locator(`.awkit-flow-node[data-id="${nodeId}"]`).boundingBox();
    if (nodeBox) {
      await win.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
      await win.mouse.down();
      await win.mouse.move(nodeBox.x + nodeBox.width / 2 + 36, nodeBox.y + nodeBox.height / 2 - 20, { steps: 6 });
      await win.mouse.up();
    }
    const dragStable = await waitForLoopCapsuleLayoutStable(win, nodeId);
    const afterDrag = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Dragging the Flow node keeps the capsule, dominant ring, value, and attachment geometry together",
      Boolean(nodeBox) && dragStable && beforeDrag?.side === "right" && afterDrag?.side === "right" &&
        loopCapsuleMovedWithNode(beforeDrag, afterDrag) && matchesLoopCapsuleContract(afterDrag, { owner: nodeId, value: 10 }) &&
        Number.isFinite(beforeDrag.sweepAnimationStartTime) && afterDrag.sweepAnimationStartTime === beforeDrag.sweepAnimationStartTime,
      JSON.stringify({ dragStable, beforeDrag, afterDrag })
    );

    const secondNodeId = "fill";
    const primaryBeforeSecond = await readLoopCapsuleVisual(win, nodeId);
    await clickNodeMenuItem(win, secondNodeId, "Add loop");
    await waitForLoop(win, secondNodeId);
    await maxIterations.fill("7");
    await waitForConfiguredValue(win, secondNodeId, 7);
    const peersStable = await Promise.all([
      waitForLoopCapsuleLayoutStable(win, nodeId),
      waitForLoopCapsuleLayoutStable(win, secondNodeId)
    ]);
    const firstWithSecond = await readLoopCapsuleVisual(win, nodeId);
    const secondVisual = await readLoopCapsuleVisual(win, secondNodeId);
    const normalPeerMotion = await Promise.all([
      readLoopCapsuleMotion(win, nodeId),
      readLoopCapsuleMotion(win, secondNodeId)
    ]);
    check(
      "Two Flow Loops retain independent identities, values, labels, selection, and normal sweep motion",
      peersStable.every(Boolean) && firstWithSecond?.edgeId !== secondVisual?.edgeId && matchesLoopCapsuleContract(firstWithSecond, { owner: nodeId, value: 10 }) &&
        matchesLoopCapsuleContract(secondVisual, { owner: secondNodeId, value: 7 }) &&
        firstWithSecond?.labelText === "While · status = passed" && secondVisual?.labelText === "Count × 7" &&
        firstWithSecond.selected === false && secondVisual.selected === true &&
        firstWithSecond.duplicateLoopDomIdCount === 0 && secondVisual.duplicateLoopDomIdCount === 0 &&
        firstWithSecond.sweepAnimationStartTime === primaryBeforeSecond?.sweepAnimationStartTime &&
        Number.isFinite(secondVisual.sweepAnimationStartTime) && secondVisual.sweepAnimationStartTime !== firstWithSecond.sweepAnimationStartTime &&
        normalPeerMotion.every((item) => item?.moved && Number.isFinite(item.delta) && item.delta >= 100 &&
          !item.valueMoved && !item.labelMoved && item.valueAnimationCount === 0 && item.labelAnimationCount === 0 &&
          item.beforeStartTime === item.afterStartTime),
      JSON.stringify({ firstWithSecond, secondVisual, normalPeerMotion })
    );

    await win.emulateMedia({ reducedMotion: "reduce" });
    const reducedPeerMotion = await Promise.all([
      readLoopCapsuleMotion(win, nodeId),
      readLoopCapsuleMotion(win, secondNodeId)
    ]);
    const reducedPeers = await Promise.all([
      readLoopCapsuleVisual(win, nodeId),
      readLoopCapsuleVisual(win, secondNodeId)
    ]);
    check(
      "Reduced motion freezes both independent Flow sweeps without hiding either value or label",
      reducedPeers.every((item, index) => matchesLoopCapsuleContract(item, { owner: index === 0 ? nodeId : secondNodeId, value: index === 0 ? 10 : 7 }) &&
        item.animationName === "none" && item.valueDisplay !== "none" && item.labelDisplay !== "none") &&
        reducedPeerMotion.every((item) => item && !item.moved && !item.valueMoved && !item.labelMoved),
      JSON.stringify({ reducedPeers, reducedPeerMotion })
    );
    await win.emulateMedia({ reducedMotion: "no-preference" });

    if (process.env.AWKIT_FLOW_LOOP_EVIDENCE || process.env.AWKIT_FLOW_LOOP_EVIDENCE_DARK) {
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      await fitAndStabilize(win, [nodeId, secondNodeId]);
    }
    if (process.env.AWKIT_FLOW_LOOP_EVIDENCE) {
      await win.screenshot({ path: process.env.AWKIT_FLOW_LOOP_EVIDENCE });
    }
    if (process.env.AWKIT_FLOW_LOOP_EVIDENCE_DARK) {
      const evidenceTheme = await win.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "light");
      await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await waitForLoopCapsuleLayoutStable(win, nodeId);
      await win.screenshot({ path: process.env.AWKIT_FLOW_LOOP_EVIDENCE_DARK });
      await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), evidenceTheme);
    }
    await clickNodeMenuItem(win, secondNodeId, "Remove loop");
    await waitForLoop(win, secondNodeId, false);

    await clickNodeMenuItem(win, nodeId, "Configure loop");
    await maxIterations.fill("12");
    await waitForConfiguredValue(win, nodeId, 12);
    const unsavedVisual = await readLoopCapsuleVisual(win, nodeId);
    await win.getByRole("button", { name: "Save", exact: true }).click();
    // `polling: 100` is deliberate, and NOT an arbitrary sleep. waitForFunction defaults to
    // polling on requestAnimationFrame, which only ticks while the window is compositing — but this
    // predicate asks about PERSISTED state reached through an async IPC round-trip, not about
    // anything being painted. When the window is not compositing (occluded, backgrounded, or just
    // settling after a save) the predicate is never re-evaluated and this times out at 30s even
    // though the save landed immediately. That is the abort captured in awkit-r9f3. A time-based
    // poll is the correct strategy for a non-visual condition; the assertion itself is unchanged.
    await win.waitForFunction(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      return profile?.edges.some((edge) => edge.source === "goto" && edge.target === "goto" && edge.loop?.maxIterations === 12);
    }, undefined, { polling: 100 });
    const saved = await win.evaluate(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      const loopEdge = profile?.edges.find((edge) => edge.source === "goto" && edge.target === "goto");
      const exits = profile?.edges.filter((edge) => edge.source === "goto" && edge.target !== "goto") ?? [];
      return { loopEdge, exits };
    });
    check(
      "Flow Loop first save preserves authored configuration, style, and exactly one promoted Conditional exit",
      matchesLoopCapsuleContract(unsavedVisual, { owner: nodeId, value: 12 }) && unsavedVisual?.labelText === "While · status = passed" &&
        normalizeDash(unsavedVisual.pathStrokeDash) === "1 5" && Number.parseFloat(unsavedVisual.pathStrokeWidth) === 4 &&
        saved.loopEdge?.kind === "loop" && saved.loopEdge?.loop?.mode === "whileCondition" &&
        saved.loopEdge?.loop?.maxIterations === 12 && saved.loopEdge?.loop?.condition?.sourceField === "status" &&
        saved.loopEdge?.loop?.condition?.operator === "equals" && saved.loopEdge?.loop?.condition?.expectedValue === "passed" &&
        saved.loopEdge?.style?.lineStyle === "dotted" && saved.loopEdge?.style?.thickness === 4 && saved.loopEdge?.style?.shape === "smoothstep" &&
        saved.exits.length === 1 && saved.exits[0]?.kind === "conditional" && saved.exits[0]?.conditional?.operator === "always",
      JSON.stringify({ unsavedVisual, saved })
    );

    await win.getByTitle("Reload selected flow").click();
    await waitForLoop(win, nodeId);
    await waitForConfiguredValue(win, nodeId, 12);
    const firstReloaded = await readLoopCapsuleVisual(win, nodeId);
    const hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await loopMode.waitFor({ state: "visible" });
    const firstReloadedEditor = {
      mode: await loopMode.inputValue(),
      maxIterations: await maxIterations.inputValue(),
      lineStyle: await lineStyle.inputValue(),
      thickness: await thickness.inputValue(),
      shape: await connectorShape.inputValue()
    };

    // The reload resets editor history to the exact persisted state. A single reconfiguration can
    // therefore prove Undo/Redo without racing or contradicting the editor's intentional coalescing.
    await maxIterations.fill("14");
    await waitForConfiguredValue(win, nodeId, 14);
    await waitForHistoryControl(win, "flow-undo");
    await win.locator('[data-testid="flow-undo"]').click();
    await waitForConfiguredValue(win, nodeId, 12);
    const configurationUndoVisual = await readLoopCapsuleVisual(win, nodeId);
    await ensureLoopConfigVisible(win, nodeId, maxIterations);
    const configurationUndoExact = await maxIterations.inputValue() === "12";
    await waitForHistoryControl(win, "flow-redo");
    await win.locator('[data-testid="flow-redo"]').click();
    await waitForConfiguredValue(win, nodeId, 14);
    const configurationRedoVisual = await readLoopCapsuleVisual(win, nodeId);
    await ensureLoopConfigVisible(win, nodeId, maxIterations);
    const configurationRedoExact = await maxIterations.inputValue() === "14";
    const secondUnsavedVisual = await readLoopCapsuleVisual(win, nodeId);
    await win.getByRole("button", { name: "Save", exact: true }).click();
    // Time-based polling for the same reason as the first save above: a persisted-state predicate
    // must not depend on the window compositing.
    await win.waitForFunction(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      const edge = profile?.edges.find((candidate) => candidate.source === "goto" && candidate.target === "goto");
      return edge?.loop?.maxIterations === 14 && edge.style?.lineStyle === "dotted" &&
        edge.style?.thickness === 4 && edge.style?.shape === "smoothstep";
    }, undefined, { polling: 100 });
    const secondSaved = await win.evaluate(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      const loopEdge = profile?.edges.find((edge) => edge.source === "goto" && edge.target === "goto");
      const exits = profile?.edges.filter((edge) => edge.source === "goto" && edge.target !== "goto") ?? [];
      return { loopEdge, exits };
    });
    await win.getByTitle("Reload selected flow").click();
    await waitForLoop(win, nodeId);
    await waitForConfiguredValue(win, nodeId, 14);
    const secondReloaded = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Flow Loop reload, config Undo/Redo, and second reconfigure/save/reload preserve the exact capsule state",
      matchesLoopCapsuleContract(firstReloaded, { owner: nodeId, value: 12 }) && firstReloaded?.labelText === "While · status = passed" &&
        normalizeDash(firstReloaded.pathStrokeDash) === "1 5" && Number.parseFloat(firstReloaded.pathStrokeWidth) === 4 &&
        firstReloadedEditor.mode === "whileCondition" && firstReloadedEditor.maxIterations === "12" &&
        firstReloadedEditor.lineStyle === "dotted" && firstReloadedEditor.thickness === "4" && firstReloadedEditor.shape === "smoothstep" &&
        configurationUndoExact && configurationRedoExact &&
        matchesLoopCapsuleContract(configurationUndoVisual, { owner: nodeId, value: 12 }) &&
        matchesLoopCapsuleContract(configurationRedoVisual, { owner: nodeId, value: 14 }) &&
        matchesLoopCapsuleContract(secondUnsavedVisual, { owner: nodeId, value: 14 }) &&
        matchesLoopCapsuleContract(secondReloaded, { owner: nodeId, value: 14 }) && secondReloaded?.labelText === "While · status = passed" &&
        normalizeDash(secondReloaded.pathStrokeDash) === "1 5" && Number.parseFloat(secondReloaded.pathStrokeWidth) === 4 &&
        secondSaved.loopEdge?.loop?.mode === "whileCondition" && secondSaved.loopEdge?.loop?.maxIterations === 14 &&
        secondSaved.loopEdge?.loop?.condition?.sourceField === "status" && secondSaved.loopEdge?.loop?.condition?.operator === "equals" &&
        secondSaved.loopEdge?.loop?.condition?.expectedValue === "passed" && secondSaved.loopEdge?.style?.lineStyle === "dotted" &&
        secondSaved.loopEdge?.style?.thickness === 4 && secondSaved.loopEdge?.style?.shape === "smoothstep" &&
        secondSaved.exits.length === 1 && secondSaved.exits[0]?.kind === "conditional" && secondSaved.exits[0]?.conditional?.operator === "always",
      JSON.stringify({ firstReloaded, firstReloadedEditor, configurationUndoExact, configurationUndoVisual,
        configurationRedoExact, configurationRedoVisual, secondUnsavedVisual, secondSaved, secondReloaded })
    );

    // Exercise destructive history against the second persisted authored state. Each transition is
    // synchronized on Loop presence/value, and the final Undo must restore configuration, style,
    // topology, and the same capsule oracle rather than merely recreating a default Loop.
    await hit.click();
    await loopMode.waitFor({ state: "visible" });
    const directTargetMode = await loopMode.inputValue();
    const loopGroup = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
    await loopGroup.focus();
    await loopGroup.press("Delete");
    await waitForLoop(win, nodeId, false);
    const deletedByKeyboard = await loopGroup.count() === 0;
    await waitForHistoryControl(win, "flow-undo");
    await win.locator('[data-testid="flow-undo"]').click();
    await waitForLoop(win, nodeId);
    await waitForConfiguredValue(win, nodeId, 14);
    const firstDeleteUndo = await readLoopCapsuleVisual(win, nodeId);
    await waitForHistoryControl(win, "flow-redo");
    await win.locator('[data-testid="flow-redo"]').click();
    await waitForLoop(win, nodeId, false);
    const deletedAgainByRedo = await loopGroup.count() === 0;
    await waitForHistoryControl(win, "flow-undo");
    await win.locator('[data-testid="flow-undo"]').click();
    await waitForLoop(win, nodeId);
    await waitForConfiguredValue(win, nodeId, 14);
    const finalDeleteUndo = await readLoopCapsuleVisual(win, nodeId);
    await hit.click();
    await loopMode.waitFor({ state: "visible" });
    const restoredEditor = {
      mode: await loopMode.inputValue(),
      maxIterations: await maxIterations.inputValue(),
      lineStyle: await lineStyle.inputValue(),
      thickness: await thickness.inputValue(),
      shape: await connectorShape.inputValue()
    };
    const restoredTopology = await win.evaluate((id) => {
      const outgoing = [...document.querySelectorAll(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"]`)];
      const exits = outgoing.filter((edge) => edge.getAttribute("data-target") !== id);
      return {
        loops: outgoing.filter((edge) => edge.getAttribute("data-target") === id && edge.getAttribute("data-connector-kind") === "loop").length,
        exits: exits.length,
        loopExitControls: exits.filter((edge) => {
          const edgeId = edge.getAttribute("data-id");
          return edgeId && document.querySelector(`button.awkit-edge-add[data-edge-id="${CSS.escape(edgeId)}"][data-insert-role="loop-exit"]`);
        }).length
      };
    }, nodeId);
    check(
      "Flow Loop direct target and Delete/Undo/Redo restore its exact authored state",
      directTargetMode === "whileCondition" && deletedByKeyboard && deletedAgainByRedo &&
        matchesLoopCapsuleContract(firstDeleteUndo, { owner: nodeId, value: 14 }) &&
        matchesLoopCapsuleContract(finalDeleteUndo, { owner: nodeId, value: 14 }) &&
        firstDeleteUndo?.labelText === "While · status = passed" && finalDeleteUndo?.labelText === "While · status = passed" &&
        normalizeDash(firstDeleteUndo.pathStrokeDash) === "1 5" && Number.parseFloat(firstDeleteUndo.pathStrokeWidth) === 4 &&
        normalizeDash(finalDeleteUndo.pathStrokeDash) === "1 5" && Number.parseFloat(finalDeleteUndo.pathStrokeWidth) === 4 &&
        restoredEditor.mode === "whileCondition" && restoredEditor.maxIterations === "14" &&
        restoredEditor.lineStyle === "dotted" && restoredEditor.thickness === "4" && restoredEditor.shape === "smoothstep" &&
        restoredTopology.loops === 1 && restoredTopology.exits === 1 && restoredTopology.loopExitControls === 1,
      JSON.stringify({ directTargetMode, deletedByKeyboard, firstDeleteUndo, deletedAgainByRedo, finalDeleteUndo, restoredEditor, restoredTopology })
    );

    /* Inspector-initiated deletion, then Undo (awkit-6be).
       The pre-capsule walkthrough covered this, but its Undo assertion required `directionCount`
       and `arrowCount` — descendants the capsule design removed — so it was retired and NOTHING
       replaced it. Keyboard deletion above is a different code path: it goes through the canvas
       key handler, while this goes through the connection inspector's own Delete control. Only the
       ASSERTION was U-route-specific; the interaction is still the product's, so it is re-bound
       here against the capsule contract instead of being lost with the visual it used to check. */
    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await clickNodeMenuItem(win, nodeId, "Configure loop");
    const inspectorDelete = win.getByTitle("Delete connection");
    const inspectorDeleteVisible = await inspectorDelete.isVisible().catch(() => false);
    if (inspectorDeleteVisible) await inspectorDelete.click();
    await win.waitForFunction(
      (id) => !document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`),
      nodeId,
      { timeout: 5_000 }
    ).catch(() => undefined);
    const afterInspectorDelete = await win.evaluate((id) => ({
      hasSelfLoop: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)),
      hasLoopExitControl: Boolean(document.querySelector('button.awkit-edge-add[data-insert-role="loop-exit"]'))
    }), nodeId);

    await waitForHistoryControl(win, "flow-undo");
    await win.locator('[data-testid="flow-undo"]').click();
    await loopGroup.waitFor({ state: "attached", timeout: 5_000 }).catch(() => undefined);
    const inspectorDeleteUndo = await readLoopCapsuleVisual(win, nodeId);

    check(
      "Undo restores an inspector-deleted Flow Loop with its exact capsule state",
      inspectorDeleteVisible &&
        !afterInspectorDelete.hasSelfLoop &&
        !afterInspectorDelete.hasLoopExitControl &&
        matchesLoopCapsuleContract(inspectorDeleteUndo, { owner: nodeId, value: 14 }) &&
        inspectorDeleteUndo?.labelText === "While · status = passed" &&
        normalizeDash(inspectorDeleteUndo.pathStrokeDash) === "1 5" &&
        Number.parseFloat(inspectorDeleteUndo.pathStrokeWidth) === 4,
      JSON.stringify({ inspectorDeleteVisible, ...afterInspectorDelete, inspectorDeleteUndo })
    );

    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await loopGroup.focus();
    await win.keyboard.press("Enter");
    await loopMode.waitFor({ state: "visible" });
    const enterAccessible = (await loopGroup.getAttribute("aria-label"))?.includes("While · status = passed");
    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await loopGroup.focus();
    await win.keyboard.press("Space");
    await loopMode.waitFor({ state: "visible" });
    const spaceAccessible = await loopMode.inputValue() === "whileCondition";
    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    await hit.dblclick();
    await loopMode.waitFor({ state: "visible" });
    check("Flow Loop configuration remains accessible by pointer, double-click, Enter, and Space", enterAccessible && spaceAccessible &&
      await loopMode.inputValue() === "whileCondition" && await maxIterations.inputValue() === "14");

    await app.close();
    cleanup();
    const checkContractMatches = matchesFlowLoopCapsuleCheckContract(results);
    if (!checkContractMatches) {
      console.error(`Focused Flow Loop check contract failed: observed ${results.length}/${FLOW_LOOP_CAPSULE_CHECK_NAMES.length} exact named checks.`);
    }
    return { pass: checkContractMatches && results.every((result) => result.pass), results, checkContractMatches };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    console.error("Focused Flow Loop capsule verifier failed:", error);
    return { pass: false, results, error: error instanceof Error ? error.message : String(error) };
  }
}
