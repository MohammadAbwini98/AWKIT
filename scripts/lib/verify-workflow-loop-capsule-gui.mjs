import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  loopCapsuleMovedWithNode,
  matchesLoopCapsuleContract,
  readLoopCapsuleMotion,
  readLoopCapsulePixelMotion,
  readLoopCapsuleVisual,
  rejectsLoopURouteHybrid
} from "./loop-capsule-visual-oracle.mjs";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./gui-verify-harness.mjs";

const WF_SELECT = 'label.sb-toolbar-field:has(span:text-is("Workflow")) select';

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
    nodes: [mkNode("workflow-node-1", "capsule-flow-a", 1, 260), mkNode("workflow-node-2", "capsule-flow-b", 2, 620)],
    edges: [{ id: "exit", source: "workflow-node-1", target: "workflow-node-2", type: "success", label: "always" }],
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

async function waitForLoop(win, nodeId, present = true) {
  await win.waitForFunction(({ id, expected }) => Boolean(document.querySelector(
    `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator`
  )) === expected, { id: nodeId, expected: present });
}

async function waitForValue(win, nodeId, value) {
  await win.waitForFunction(({ id, expected }) => (document.querySelector(
    `g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"] .awkit-loop-indicator-value`
  )?.textContent ?? "").trim() === expected, { id: nodeId, expected: String(value) });
}

export async function runWorkflowLoopCapsuleSuite(root) {
  const results = [];
  const check = (name, pass, detail) => {
    const passed = Boolean(pass);
    results.push({ name, pass: passed, detail });
    console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-workflow-loop-capsule-gui");
  seedWorkflow(dataRoot);
  const app = await electron.launch({ args: [root, `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`], cwd: root, env });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);
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
    await clickNodeMenuItem(win, nodeId, "Add loop");
    await waitForLoop(win, nodeId);
    const loopMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    const maxIterations = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
    await loopMode.waitFor({ state: "visible" });
    await waitForValue(win, nodeId, 3);
    const initial = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop default renders the approved capsule, dominant ring, configured value, and sweep",
      matchesLoopCapsuleContract(initial, { owner: nodeId, value: 3 }) && initial?.labelText === "Count × 3",
      JSON.stringify(initial)
    );
    check("Workflow Loop capsule oracle rejects the superseded U-route hybrid", rejectsLoopURouteHybrid(initial), JSON.stringify(initial));

    await loopMode.selectOption("whileCondition");
    await maxIterations.fill("10");
    await win.locator('.scenario-properties-panel label:has-text("Line style") select').selectOption("dotted");
    await win.locator('.scenario-properties-panel label:has-text("Thickness") select').selectOption("4");
    await win.locator('.scenario-properties-panel label:has-text("Connector shape") select').selectOption("smoothstep");
    await waitForValue(win, nodeId, 10);
    const visual = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow Loop keeps mode-aware design text while the ring displays maxIterations",
      matchesLoopCapsuleContract(visual, { owner: nodeId, value: 10 }) && visual?.labelText === "While · status = passed" &&
        !/\b\d+\s*\/\s*\d+\b|\biteration\b/i.test(visual?.ariaLabel ?? ""),
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
        visual.animationTimingFunction === "linear" && Number.parseFloat(visual.animationDuration) > 0 &&
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

    const beforeDrag = await readLoopCapsuleVisual(win, nodeId);
    const box = await win.locator(`.awkit-flow-node[data-id="${nodeId}"]`).boundingBox();
    if (box) {
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2 + 20, { steps: 6 });
      await win.mouse.up();
    }
    const afterDrag = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Dragging the Workflow node preserves capsule attachment, ring/value ownership, and geometry",
      Boolean(box) && loopCapsuleMovedWithNode(beforeDrag, afterDrag) && matchesLoopCapsuleContract(afterDrag, { owner: nodeId, value: 10 }),
      JSON.stringify({ beforeDrag, afterDrag })
    );

    const secondId = "workflow-node-2";
    await clickNodeMenuItem(win, secondId, "Add loop");
    await waitForLoop(win, secondId);
    await maxIterations.fill("7");
    await waitForValue(win, secondId, 7);
    const firstWithPeer = await readLoopCapsuleVisual(win, nodeId);
    const second = await readLoopCapsuleVisual(win, secondId);
    check(
      "Two Workflow Loops keep independent edge identities, values, labels, and capsule controls",
      firstWithPeer?.edgeId !== second?.edgeId && matchesLoopCapsuleContract(firstWithPeer, { owner: nodeId, value: 10 }) &&
        matchesLoopCapsuleContract(second, { owner: secondId, value: 7 }) && firstWithPeer?.labelText === "While · status = passed" && second?.labelText === "Count × 7",
      JSON.stringify({ firstWithPeer, second })
    );
    await clickNodeMenuItem(win, secondId, "Remove loop");
    await waitForLoop(win, secondId, false);

    await clickNodeMenuItem(win, nodeId, "Configure loop");
    await maxIterations.fill("12");
    await waitForValue(win, nodeId, 12);
    await win.getByRole("button", { name: "Save", exact: true }).click();
    await win.waitForFunction(async () => {
      const profile = await window.playwrightFlowStudio.workflows.get("verify-workflow-loop-capsule");
      return profile?.edges.some((edge) => edge.source === "workflow-node-1" && edge.target === "workflow-node-1" && edge.loop?.maxIterations === 12);
    });
    const persisted = await win.evaluate(async () => {
      const profile = await window.playwrightFlowStudio.workflows.get("verify-workflow-loop-capsule");
      const outgoing = profile?.edges.filter((edge) => edge.source === "workflow-node-1") ?? [];
      return {
        loop: outgoing.find((edge) => edge.target === "workflow-node-1" && edge.type === "loop"),
        exits: outgoing.filter((edge) => edge.target !== "workflow-node-1")
      };
    });
    check(
      "Workflow save preserves Loop configuration and exactly one promoted Conditional exit",
      persisted.loop?.loop?.mode === "whileCondition" && persisted.loop?.loop?.maxIterations === 12 &&
        persisted.exits.length === 1 && persisted.exits[0]?.type === "conditional" && persisted.exits[0]?.condition?.expression === "true",
      JSON.stringify(persisted)
    );

    await win.selectOption(WF_SELECT, "verify-workflow").catch(() => undefined);
    await win.selectOption(WF_SELECT, "verify-workflow-loop-capsule");
    await waitForLoop(win, nodeId);
    await waitForValue(win, nodeId, 12);
    const reloaded = await readLoopCapsuleVisual(win, nodeId);
    check(
      "Workflow reload preserves the capsule contract and exact configured value",
      matchesLoopCapsuleContract(reloaded, { owner: nodeId, value: 12 }) && reloaded?.labelText === "While · status = passed",
      JSON.stringify(reloaded)
    );

    const hit = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-hit`);
    await hit.click();
    await loopMode.waitFor({ state: "visible" });
    check("Workflow dominant ring remains a direct configuration target", await loopMode.inputValue() === "whileCondition");
    await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
    const group = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"][role="button"]`);
    await group.focus();
    await win.keyboard.press("Enter");
    await loopMode.waitFor({ state: "visible" });
    check("Workflow Loop configuration remains keyboard-accessible", (await group.getAttribute("aria-label"))?.includes("While · status = passed"));

    await app.close();
    cleanup();
    return { pass: results.every((result) => result.pass), results };
  } catch (error) {
    try { await app.close(); } catch { /* ignore */ }
    cleanup();
    console.error("Focused Workflow Loop capsule verifier failed:", error);
    return { pass: false, results, error: error instanceof Error ? error.message : String(error) };
  }
}
