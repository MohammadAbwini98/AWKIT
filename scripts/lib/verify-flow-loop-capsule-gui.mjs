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
  )) === expected, { id: nodeId, expected: present });
}

async function waitForConfiguredValue(win, nodeId, value) {
  await win.waitForFunction(({ id, expected }) => {
    const text = document.querySelector(
      `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-value`
    );
    return (text?.textContent ?? "").trim() === expected;
  }, { id: nodeId, expected: String(value) });
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
    const passed = Boolean(pass);
    results.push({ name, pass: passed, detail });
    console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
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
    await win.locator('.connection-config-drawer label:has-text("Line style") select').selectOption("dotted");
    await win.locator('.connection-config-drawer label:has-text("Thickness") select').selectOption("4");
    await win.locator('.connection-config-drawer label:has-text("Connector shape") select').selectOption("smoothstep");
    await waitForConfiguredValue(win, nodeId, 10);
    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const visual = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Flow Loop configured value is design-time maxIterations while the label stays mode-aware",
      matchesLoopCapsuleContract(visual, { owner: nodeId, value: 10 }) &&
        visual?.labelText === "While · status = passed" &&
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
      "Flow Loop rotates only the circular sweep while value and label remain stationary",
      visual?.animationName === "awkit-loop-control-orbit" && visual.animationIterationCount === "infinite" &&
        visual.animationTimingFunction === "linear" && Number.parseFloat(visual.animationDuration) === 2 && visual.sweepAnimationCount === 1 &&
        visual.sweepPathLength === "100" && String(visual.sweepDash).replace(/px|,/g, " ").trim().replace(/\s+/g, " ") === "22 78" &&
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
    check(
      "Flow Loop capsule remains attached and structurally identical at 25%, 100%, and 200% zoom",
      at25.percent === 25 && at100.percent === 100 && at200.percent === 200 &&
        [at25, at100, at200].every((sample) => sample.stable && matchesLoopCapsuleContract(sample.visual, { owner: nodeId, value: 10 }) &&
          sample.visual.laneAttachedToNode && sample.visual.sameSideAttachment && !sample.visual.pathWrapsWholeNode),
      JSON.stringify({ at25, at100, at200 })
    );

    await waitForLoopCapsuleLayoutStable(win, nodeId);
    const beforeDrag = await readLoopCapsuleVisual(win, nodeId);
    const nodeBox = await win.locator(`.awkit-flow-node[data-id="${nodeId}"]`).boundingBox();
    if (nodeBox) {
      await win.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
      await win.mouse.down();
      await win.mouse.move(nodeBox.x + nodeBox.width / 2 + 36, nodeBox.y + nodeBox.height / 2 + 20, { steps: 6 });
      await win.mouse.up();
    }
    const dragStable = await waitForLoopCapsuleLayoutStable(win, nodeId);
    const afterDrag = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Dragging the Flow node keeps the capsule, dominant ring, value, and attachment geometry together",
      Boolean(nodeBox) && dragStable && beforeDrag?.side === "right" && afterDrag?.side === "right" &&
        loopCapsuleMovedWithNode(beforeDrag, afterDrag) && matchesLoopCapsuleContract(afterDrag, { owner: nodeId, value: 10 }),
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
    check(
      "Two Flow Loops retain independent identities, values, labels, and capsule controls",
      peersStable.every(Boolean) && firstWithSecond?.edgeId !== secondVisual?.edgeId && matchesLoopCapsuleContract(firstWithSecond, { owner: nodeId, value: 10 }) &&
        matchesLoopCapsuleContract(secondVisual, { owner: secondNodeId, value: 7 }) &&
        firstWithSecond?.labelText === "While · status = passed" && secondVisual?.labelText === "Count × 7" &&
        firstWithSecond.selected === false && secondVisual.selected === true &&
        firstWithSecond.duplicateLoopDomIdCount === 0 && secondVisual.duplicateLoopDomIdCount === 0 &&
        firstWithSecond.sweepAnimationStartTime === primaryBeforeSecond?.sweepAnimationStartTime &&
        Number.isFinite(secondVisual.sweepAnimationStartTime) && secondVisual.sweepAnimationStartTime !== firstWithSecond.sweepAnimationStartTime,
      JSON.stringify({ firstWithSecond, secondVisual })
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
    await win.waitForFunction(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      return profile?.edges.some((edge) => edge.source === "goto" && edge.target === "goto" && edge.loop?.maxIterations === 12);
    });
    const saved = await win.evaluate(async () => {
      const profile = await window.playwrightFlowStudio.flows.get("verify-flow-loop-capsule");
      const loopEdge = profile?.edges.find((edge) => edge.source === "goto" && edge.target === "goto");
      const exits = profile?.edges.filter((edge) => edge.source === "goto" && edge.target !== "goto") ?? [];
      return { loopEdge, exits };
    });
    check(
      "Flow Loop save preserves functional configuration and exactly one promoted Conditional exit",
      unsavedVisual?.valueText === "12" && saved.loopEdge?.kind === "loop" && saved.loopEdge?.loop?.mode === "whileCondition" &&
        saved.loopEdge?.loop?.maxIterations === 12 && saved.exits.length === 1 && saved.exits[0]?.kind === "conditional",
      JSON.stringify(saved)
    );

    await win.getByTitle("Reload selected flow").click();
    await waitForLoop(win, nodeId);
    await waitForConfiguredValue(win, nodeId, 12);
    const reloaded = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Flow Loop reload preserves the capsule visual contract and configured value",
      matchesLoopCapsuleContract(reloaded, { owner: nodeId, value: 12 }) && reloaded?.labelText === "While · status = passed",
      JSON.stringify(reloaded)
    );

    const hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click({ force: false });
    await loopMode.waitFor({ state: "visible" });
    check("Flow Loop dominant ring remains a direct configuration target", await loopMode.inputValue() === "whileCondition");
    const loopGroup = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
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
    check("Flow Loop configuration remains accessible by pointer, double-click, Enter, and Space", enterAccessible && spaceAccessible && await loopMode.inputValue() === "whileCondition");

    await app.close();
    cleanup();
    return { pass: results.every((result) => result.pass), results };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    console.error("Focused Flow Loop capsule verifier failed:", error);
    return { pass: false, results, error: error instanceof Error ? error.message : String(error) };
  }
}
