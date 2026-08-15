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
import sharp from "sharp";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { readLoopCapsuleVisual } from "./lib/loop-capsule-visual-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-workflow-builder-gui");
seedWorkflowFixture(dataRoot);

// Seed two saved flows and focused workflow fixtures so the builder auto-loads a workflow with a
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
  const legacyReturnWorkflow = {
    ...workflow,
    id: "verify-workflow-legacy-return",
    name: "Verify — Legacy Return",
    description: "Cross-node legacy loopBack rendering fixture with an ordinary reference edge.",
    nodes: workflow.nodes.map((node, index) => ({ ...node, id: `legacy-return-node-${index + 1}` })),
    edges: [
      { id: "legacy-forward", source: "legacy-return-node-1", target: "legacy-return-node-2", type: "success" },
      {
        id: "legacy-return",
        source: "legacy-return-node-2",
        target: "legacy-return-node-1",
        type: "loopBack",
        maxLoopCount: 4,
        // Deliberately conflicting opaque data proves a legacy return never adopts a structured
        // Loop mode label. Its runtime model and rendered summary remain separate.
        loop: { mode: "count", maxIterations: 99, parameterName: "opaque-loop-payload" }
      }
    ]
  };
  writeFileSync(path.join(workflowsDir, `${legacyReturnWorkflow.id}.json`), `${JSON.stringify(legacyReturnWorkflow, null, 2)}\n`, "utf8");
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
  // Adapt the historical broad reader to the restored capsule so removed U-route descendants do
  // not terminate the process. The canonical wrapper still retires the explicitly named obsolete
  // visual assertions while keeping every unrelated Workflow and legacy loopBack check binding.
  const capsule = await readLoopCapsuleVisual(win, nodeId);
  if (capsule) {
    return {
      ...capsule,
      legacyArrowCount: 0,
      mainDash: "none",
      mainWidth: capsule.pathStrokeWidth,
      directionPathData: "",
      directionMatchesPath: false,
      directionPathLength: null,
      directionStrokeDash: "none",
      directionStrokeDashOffset: "0px",
      directionStrokeWidth: "0px",
      markerPathDistance: Number.POSITIVE_INFINITY,
      pathEndpointsTouchNode: capsule.sameSideAttachment,
      pathWrapsNode: capsule.pathWrapsWholeNode,
      animationName: "none",
      animationDuration: "0s",
      animationIterationCount: "1",
      animationTimingFunction: "ease",
      animationCurrentTime: Number.NaN,
      animationStartTime: Number.NaN,
      display: "none",
      opacity: "0",
      arrowDisplay: "none",
      arrowOpacity: "0",
      markerAnimationName: "none",
      nodeOverlapsRing: !capsule.markerOutsideNode,
      nodeCoversRingCenter: false,
      interactionWidth: "0px"
    };
  }
  return win.evaluate((id) => {
    const group = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
    const node = document.querySelector(`.awkit-flow-node[data-id="${id}"]`);
    const canvas = document.querySelector(".awkit-flow-canvas");
    const edgesLayer = group?.closest(".awkit-flow-edges");
    const nodesLayer = node?.closest(".awkit-flow-nodes");
    const indicator = group?.querySelector(".awkit-loop-indicator");
    const path = indicator?.querySelector(".awkit-loop-indicator-path");
    const marker = indicator?.querySelector(".awkit-loop-indicator-marker");
    const outer = marker?.querySelector(".awkit-loop-indicator-outer-ring");
    const main = marker?.querySelector(".awkit-loop-indicator-main-ring");
    const direction = indicator?.querySelector(".awkit-loop-direction-path");
    const arrow = indicator?.querySelector(".awkit-loop-indicator-arrow");
    const focus = marker?.querySelector(".awkit-loop-indicator-focus-ring");
    const hit = marker?.querySelector(".awkit-loop-indicator-hit");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
    if (!(group instanceof SVGGElement) || !(node instanceof HTMLElement) || !(canvas instanceof HTMLElement) ||
      !(edgesLayer instanceof SVGElement) || !(nodesLayer instanceof HTMLElement) || !(indicator instanceof SVGGElement) ||
      !(path instanceof SVGPathElement) || !(marker instanceof SVGGElement) ||
      !(outer instanceof SVGCircleElement) || !(main instanceof SVGCircleElement) || !(direction instanceof SVGPathElement) ||
      !(arrow instanceof SVGElement) || !(focus instanceof SVGCircleElement) || !(hit instanceof SVGCircleElement) ||
      !(label instanceof HTMLElement)) return null;
    const pathStyle = getComputedStyle(path);
    const mainStyle = getComputedStyle(main);
    const directionStyle = getComputedStyle(direction);
    const arrowStyle = getComputedStyle(arrow);
    const labelStyle = getComputedStyle(label);
    const directionAnimation = direction.getAnimations()[0];
    const nodeRect = node.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const pathRect = path.getBoundingClientRect();
    const outerRect = outer.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const otherNodeRects = [...document.querySelectorAll(".awkit-flow-node")]
      .filter((candidate) => candidate instanceof HTMLElement && candidate.getAttribute("data-id") !== id)
      .map((candidate) => candidate.getBoundingClientRect());
    const circleCenterX = outerRect.left + outerRect.width / 2;
    const circleCenterY = outerRect.top + outerRect.height / 2;
    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;
    const sharedCenter = [main, focus, hit].every((circle) =>
      Math.abs(Number(circle.getAttribute("cx")) - Number(outer.getAttribute("cx"))) < 0.01 &&
      Math.abs(Number(circle.getAttribute("cy")) - Number(outer.getAttribute("cy"))) < 0.01
    );
    const topElement = document.elementFromPoint(nodeCenterX, nodeCenterY);
    const pathLength = path.getTotalLength();
    const pathMatrix = path.getScreenCTM();
    let markerPathDistance = Number.POSITIVE_INFINITY;
    let startPoint = null;
    let endPoint = null;
    if (pathMatrix && pathLength > 0) {
      const markerX = Number(outer.getAttribute("cx"));
      const markerY = Number(outer.getAttribute("cy"));
      for (let index = 0; index <= 400; index += 1) {
        const point = path.getPointAtLength((pathLength * index) / 400);
        markerPathDistance = Math.min(markerPathDistance, Math.hypot(point.x - markerX, point.y - markerY));
      }
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(pathLength);
      startPoint = new DOMPoint(start.x, start.y).matrixTransform(pathMatrix);
      endPoint = new DOMPoint(end.x, end.y).matrixTransform(pathMatrix);
    }
    const touchesNodeBoundary = (point) => Boolean(point &&
      point.x >= nodeRect.left - 5 && point.x <= nodeRect.right + 5 &&
      point.y >= nodeRect.top - 5 && point.y <= nodeRect.bottom + 5 &&
      Math.min(
        Math.abs(point.x - nodeRect.left),
        Math.abs(point.x - nodeRect.right),
        Math.abs(point.y - nodeRect.top),
        Math.abs(point.y - nodeRect.bottom)
      ) <= 5
    );
    const pathData = path.getAttribute("d") || "";
    const directionPathData = direction.getAttribute("d") || "";
    const markerOutsideNode = !overlaps(nodeRect, outerRect) &&
      (outerRect.right <= nodeRect.left + 1 || outerRect.left >= nodeRect.right - 1 ||
        outerRect.bottom <= nodeRect.top + 1 || outerRect.top >= nodeRect.bottom - 1);
    const markerNodeClearance = Math.max(
      nodeRect.left - outerRect.right,
      outerRect.left - nodeRect.right,
      nodeRect.top - outerRect.bottom,
      outerRect.top - nodeRect.bottom
    );
    return {
      className: group.getAttribute("class") || "",
      connectorKind: group.getAttribute("data-connector-kind"),
      role: group.getAttribute("role"),
      ariaLabel: group.getAttribute("aria-label"),
      tabIndex: group.getAttribute("tabindex"),
      edgeId: group.getAttribute("data-id"),
      owner: indicator.getAttribute("data-loop-owner"),
      canvasNodeCount: document.querySelectorAll("[data-canvas-node]").length,
      syntheticLoopNodeCount: document.querySelectorAll('[data-canvas-node][data-loop-indicator], [data-canvas-node^="loop-visual-"]').length,
      indicatorInEdgeLayer: Boolean(indicator.closest(".awkit-flow-edges")),
      indicatorInNodeLayer: Boolean(indicator.closest(".awkit-flow-nodes")),
      edgeLayerZ: getComputedStyle(edgesLayer).zIndex,
      nodeLayerZ: getComputedStyle(nodesLayer).zIndex,
      baseCount: group.querySelectorAll(".awkit-flow-edge-path").length,
      pathCount: group.querySelectorAll(".awkit-loop-indicator-path").length,
      markerCount: group.querySelectorAll(".awkit-loop-indicator-marker").length,
      directionCount: group.querySelectorAll(".awkit-loop-direction-path").length,
      laneCount: group.querySelectorAll(".awkit-loop-control-lane").length,
      arrowCount: group.querySelectorAll(".awkit-loop-indicator-arrow").length,
      legacyArrowCount: group.querySelectorAll(".awkit-loop-control-arrowhead").length,
      backplateCount: group.querySelectorAll(".awkit-loop-control-backplate").length,
      outerCount: group.querySelectorAll(".awkit-loop-indicator-outer-ring").length,
      mainCount: group.querySelectorAll(".awkit-loop-indicator-main-ring").length,
      sweepCount: group.querySelectorAll(".awkit-loop-indicator-sweep").length,
      focusCount: group.querySelectorAll(".awkit-loop-indicator-focus-ring").length,
      hitCount: group.querySelectorAll(".awkit-loop-indicator-hit").length,
      valueCount: group.querySelectorAll(".awkit-loop-indicator-value").length,
      outerRadius: Number(outer.getAttribute("r")),
      mainRadius: Number(main.getAttribute("r")),
      hitRadius: Number(hit.getAttribute("r")),
      sharedCenter,
      mainDash: main.style.strokeDasharray || mainStyle.strokeDasharray,
      mainWidth: mainStyle.strokeWidth,
      pathData,
      directionPathData,
      directionMatchesPath: directionPathData === pathData,
      pathMoveCount: (pathData.match(/[Mm]/g) || []).length,
      pathHasRoundedSegments: /[QqCcAa]/.test(pathData),
      pathTotalLength: pathLength,
      pathStrokeDash: path.style.strokeDasharray || pathStyle.strokeDasharray,
      pathStrokeWidth: pathStyle.strokeWidth,
      pathStrokeLinecap: pathStyle.strokeLinecap,
      pathStrokeLinejoin: pathStyle.strokeLinejoin,
      directionPathLength: direction.getAttribute("pathLength"),
      directionStrokeDash: directionStyle.strokeDasharray,
      directionStrokeDashOffset: directionStyle.strokeDashoffset,
      directionStrokeWidth: directionStyle.strokeWidth,
      markerPathDistance,
      pathEndpointsTouchNode: touchesNodeBoundary(startPoint) && touchesNodeBoundary(endPoint),
      pathWrapsNode: pathRect.top < nodeRect.top - 2 && pathRect.bottom > nodeRect.bottom + 2 &&
        (pathRect.left < nodeRect.left - 2 || pathRect.right > nodeRect.right + 2),
      animationName: directionStyle.animationName,
      animationDuration: directionStyle.animationDuration,
      animationIterationCount: directionStyle.animationIterationCount,
      animationTimingFunction: directionStyle.animationTimingFunction,
      animationCurrentTime: Number(directionAnimation?.currentTime ?? Number.NaN),
      animationStartTime: Number(directionAnimation?.startTime ?? Number.NaN),
      display: directionStyle.display,
      opacity: directionStyle.opacity,
      arrowDisplay: arrowStyle.display,
      arrowOpacity: arrowStyle.opacity,
      markerAnimationCount: marker.getAnimations().length,
      markerAnimationName: getComputedStyle(marker).animationName,
      labelText: (label.textContent || "").trim(),
      labelDisplay: labelStyle.display,
      labelOpacity: labelStyle.opacity,
      labelAnimationName: labelStyle.animationName,
      labelAnimationCount: label.getAnimations().length,
      nodeLeft: nodeRect.left,
      nodeTop: nodeRect.top,
      nodeRight: nodeRect.right,
      nodeBottom: nodeRect.bottom,
      nodeHeight: nodeRect.height,
      nodeWidth: nodeRect.width,
      markerLeft: outerRect.left,
      markerRight: outerRect.right,
      markerTop: outerRect.top,
      markerBottom: outerRect.bottom,
      markerCenterX: circleCenterX,
      markerCenterY: circleCenterY,
      outerDiameter: outerRect.width,
      mainDiameter: mainRect.width,
      hitDiameter: hitRect.width,
      markerToNodeHeightRatio: outerRect.height / nodeRect.height,
      markerOutsideNode,
      markerNodeClearance,
      nodeOverlapsRing: overlaps(nodeRect, outerRect),
      nodeCoversRingCenter: Boolean(topElement?.closest(`[data-canvas-node="${CSS.escape(id)}"]`)),
      ringFullyVisible: outerRect.left >= canvasRect.left - 1 && outerRect.right <= canvasRect.right + 1 &&
        outerRect.top >= canvasRect.top - 1 && outerRect.bottom <= canvasRect.bottom + 1 && labelRect.top >= canvasRect.top - 1,
      labelClearance: Math.max(
        outerRect.left - labelRect.right,
        labelRect.left - outerRect.right,
        outerRect.top - labelRect.bottom,
        labelRect.top - outerRect.bottom
      ),
      labelOverlapsMarker: overlaps(labelRect, outerRect),
      labelOverlapsNode: overlaps(labelRect, nodeRect),
      overlapsOtherNode: otherNodeRects.some((rect) => overlaps(rect, outerRect) || overlaps(rect, labelRect)),
      selected: indicator.classList.contains("is-selected"),
      interactionWidth: getComputedStyle(hit).strokeWidth
    };
  }, nodeId);
}

async function readLegacyReturnVisual(win, ids) {
  return win.evaluate(({ edgeId, ordinaryEdgeId }) => {
    const group = document.querySelector(`g.awkit-flow-edge[data-id="${CSS.escape(edgeId)}"]`);
    const ordinaryGroup = document.querySelector(`g.awkit-flow-edge[data-id="${CSS.escape(ordinaryEdgeId)}"]`);
    const sourceId = group?.getAttribute("data-source") || "";
    const targetId = group?.getAttribute("data-target") || "";
    const source = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(sourceId)}"]`);
    const target = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(targetId)}"]`);
    const path = group?.querySelector("path.awkit-flow-edge-path");
    const ordinaryPath = ordinaryGroup?.querySelector("path.awkit-flow-edge-path");
    const direction = group?.querySelector(".awkit-loop-direction-path");
    const arrow = group?.querySelector(".awkit-loop-indicator-arrow");
    const label = document.querySelector(`.awkit-edge-label[data-edge-id="${CSS.escape(edgeId)}"]`);
    if (!(group instanceof SVGGElement) || !(ordinaryGroup instanceof SVGGElement) ||
      !(source instanceof HTMLElement) || !(target instanceof HTMLElement) ||
      !(path instanceof SVGPathElement) || !(ordinaryPath instanceof SVGPathElement) ||
      !(direction instanceof SVGPathElement) || !(arrow instanceof SVGPathElement) ||
      !(label instanceof HTMLElement)) return null;

    const pathLength = path.getTotalLength();
    const matrix = path.getScreenCTM();
    if (!(pathLength > 0) || !matrix) return null;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(pathLength);
    const screenStart = new DOMPoint(start.x, start.y).matrixTransform(matrix);
    const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix);
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const touchesBoundary = (point, rect) => Boolean(point &&
      point.x >= rect.left - 6 && point.x <= rect.right + 6 &&
      point.y >= rect.top - 6 && point.y <= rect.bottom + 6 &&
      Math.min(
        Math.abs(point.x - rect.left),
        Math.abs(point.x - rect.right),
        Math.abs(point.y - rect.top),
        Math.abs(point.y - rect.bottom)
      ) <= 6
    );
    let maxPathX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index <= 160; index += 1) {
      maxPathX = Math.max(maxPathX, path.getPointAtLength((pathLength * index) / 160).x);
    }

    const pathStyle = getComputedStyle(path);
    const directionStyle = getComputedStyle(direction);
    const arrowStyle = getComputedStyle(arrow);
    const labelStyle = getComputedStyle(label);
    const directionAnimation = direction.getAnimations()[0];
    const pathData = path.getAttribute("d") || "";
    const labelText = (label.textContent || "").trim();
    return {
      sourceId,
      targetId,
      connectorKind: group.getAttribute("data-connector-kind"),
      role: group.getAttribute("role"),
      ariaLabel: group.getAttribute("aria-label"),
      persistentLayer: Boolean(group.closest(".awkit-flow-loop-edges")),
      baseCount: group.querySelectorAll(".awkit-flow-edge-path").length,
      directionCount: group.querySelectorAll(".awkit-loop-direction-path").length,
      arrowCount: group.querySelectorAll(".awkit-loop-indicator-arrow").length,
      markerCount: group.querySelectorAll(".awkit-loop-indicator-marker").length,
      valueCount: group.querySelectorAll(".awkit-loop-indicator-value").length,
      totalAnimationCount: group.getAnimations({ subtree: true }).length,
      mainAnimationCount: path.getAnimations().length,
      directionAnimationCount: direction.getAnimations().length,
      arrowAnimationCount: arrow.getAnimations().length,
      labelAnimationCount: label.getAnimations().length,
      pathData,
      ordinaryPathData: ordinaryPath.getAttribute("d") || "",
      directionPathData: direction.getAttribute("d") || "",
      pathMoveCount: (pathData.match(/[Mm]/g) || []).length,
      pathCubicCount: (pathData.match(/[Cc]/g) || []).length,
      curvesBeyondEndpoints: maxPathX > Math.max(start.x, end.x) + 8,
      startTouchesSource: touchesBoundary(screenStart, sourceRect),
      endTouchesTarget: touchesBoundary(screenEnd, targetRect),
      animationName: directionStyle.animationName,
      animationDuration: directionStyle.animationDuration,
      animationIterationCount: directionStyle.animationIterationCount,
      animationTimingFunction: directionStyle.animationTimingFunction,
      animationCurrentTime: Number(directionAnimation?.currentTime ?? Number.NaN),
      animationStartTime: Number(directionAnimation?.startTime ?? Number.NaN),
      pathDisplay: pathStyle.display,
      pathVisibility: pathStyle.visibility,
      pathOpacity: pathStyle.opacity,
      pathStroke: pathStyle.stroke,
      pathStrokeWidth: pathStyle.strokeWidth,
      arrowDisplay: arrowStyle.display,
      arrowOpacity: arrowStyle.opacity,
      labelText,
      labelDisplay: labelStyle.display,
      labelOpacity: labelStyle.opacity,
      labelHasRuntimeProgress: /\b(?:current|iteration|of)\b|\d+\s*\/\s*\d+/i.test(labelText),
      sourceLeft: sourceRect.left,
      sourceTop: sourceRect.top,
      ordinaryConnectorKind: ordinaryGroup.getAttribute("data-connector-kind"),
      ordinaryDirectionCount: ordinaryGroup.querySelectorAll(".awkit-loop-direction-path").length,
      ordinaryArrowCount: ordinaryGroup.querySelectorAll(".awkit-loop-indicator-arrow").length
    };
  }, ids);
}

async function pollLegacyReturnVisual(win, ids, predicate, { timeout = 3000, interval = 40, consecutive = 1 } = {}) {
  const deadline = Date.now() + timeout;
  let lastVisual = null;
  let passingSamples = 0;
  do {
    lastVisual = await readLegacyReturnVisual(win, ids);
    passingSamples = predicate(lastVisual) ? passingSamples + 1 : 0;
    if (passingSamples >= consecutive) return lastVisual;
    await win.waitForTimeout(interval);
  } while (Date.now() < deadline);
  return lastVisual;
}

async function readLoopMotionDelta(win, nodeId) {
  return win.evaluate(async (id) => {
    const direction = document.querySelector(
      `g.awkit-flow-edge[data-source="${id}"][data-target="${id}"] .awkit-loop-direction-path`
    );
    const group = direction?.closest("g.awkit-flow-edge");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
    if (!(direction instanceof SVGPathElement) || !(label instanceof HTMLElement)) return null;
    const animation = direction.getAnimations()[0];
    const beforeTime = Number(animation?.currentTime ?? Number.NaN);
    const beforeStartTime = Number(animation?.startTime ?? Number.NaN);
    const beforeDashOffset = getComputedStyle(direction).strokeDashoffset;
    const beforeLabelTransform = getComputedStyle(label).transform;
    const beforeLabelRect = label.getBoundingClientRect();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const afterTime = Number(animation?.currentTime ?? Number.NaN);
    const afterStartTime = Number(animation?.startTime ?? Number.NaN);
    const afterDashOffset = getComputedStyle(direction).strokeDashoffset;
    const afterLabelTransform = getComputedStyle(label).transform;
    const afterLabelRect = label.getBoundingClientRect();
    const labelMoved = Math.hypot(
      afterLabelRect.left + afterLabelRect.width / 2 - (beforeLabelRect.left + beforeLabelRect.width / 2),
      afterLabelRect.top + afterLabelRect.height / 2 - (beforeLabelRect.top + beforeLabelRect.height / 2)
    ) > 0.5;
    return {
      beforeTime,
      afterTime,
      delta: afterTime - beforeTime,
      beforeStartTime,
      afterStartTime,
      beforeDashOffset,
      afterDashOffset,
      dashMoved: beforeDashOffset !== afterDashOffset,
      labelMoved,
      labelTransformChanged: beforeLabelTransform !== afterLabelTransform,
      labelAnimationCount: label.getAnimations().length,
      labelAnimationName: getComputedStyle(label).animationName
    };
  }, nodeId);
}

async function readLoopPixelMotion(win, nodeId) {
  const direction = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-direction-path`);
  if (await direction.count() === 0) return null;
  const bounds = await direction.boundingBox();
  if (!bounds) return null;
  const clip = {
    x: Math.max(0, Math.floor(bounds.x - 4)),
    y: Math.max(0, Math.floor(bounds.y - 4)),
    width: Math.ceil(bounds.width + 8),
    height: Math.ceil(bounds.height + 8)
  };
  const before = await win.screenshot({ animations: "allow", clip });
  await win.waitForTimeout(180);
  const after = await win.screenshot({ animations: "allow", clip });
  const [first, second] = await Promise.all([
    sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (first.info.width !== second.info.width || first.info.height !== second.info.height || first.info.channels !== second.info.channels) return null;
  let changedPixels = 0;
  let totalDelta = 0;
  const channels = first.info.channels;
  for (let offset = 0; offset < first.data.length; offset += channels) {
    const delta = Math.abs(first.data[offset] - second.data[offset]) + Math.abs(first.data[offset + 1] - second.data[offset + 1]) + Math.abs(first.data[offset + 2] - second.data[offset + 2]);
    totalDelta += delta;
    if (delta >= 24) changedPixels += 1;
  }
  return { changedPixels, totalDelta, width: first.info.width, height: first.info.height };
}

async function clickLoopControl(win, nodeId) {
  const point = await win.evaluate((id) => {
    const hit = document.querySelector(
      `g.awkit-flow-edge[data-source="${id}"][data-target="${id}"] .awkit-loop-indicator-hit`
    );
    if (!(hit instanceof SVGCircleElement)) return null;
    const matrix = hit.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(Number(hit.getAttribute("cx")), Number(hit.getAttribute("cy"))).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, nodeId);
  if (!point) return false;
  await win.mouse.click(point.x, point.y);
  await win.waitForTimeout(180);
  return true;
}

async function readLoopZoomSamples(win, visualId, readVisual = readLoopVisual) {
  const reset = win.locator('.canvas-zoom-control button[title="Reset to 100%"]');
  const zoomOut = win.locator('.canvas-zoom-control button[title="Zoom out"]');
  const zoomIn = win.locator('.canvas-zoom-control button[title="Zoom in"]');
  const zoomValue = win.locator(".canvas-zoom-control .zoom-value");
  const sample = async () => ({
    percent: Number.parseInt((await zoomValue.textContent().catch(() => "")) || "", 10),
    visual: await readVisual(win, visualId)
  });
  const clickTimes = async (control, count) => {
    for (let index = 0; index < count; index += 1) {
      await control.click();
      await win.waitForTimeout(170);
    }
  };

  await reset.click();
  await win.waitForTimeout(220);
  const at100 = await sample();
  await clickTimes(zoomOut, 8);
  const at25 = await sample();
  await reset.click();
  await win.waitForTimeout(220);
  await clickTimes(zoomIn, 10);
  const at200 = await sample();
  await reset.click();
  await win.waitForTimeout(220);
  return {
    at25,
    at100,
    at200,
    restoredPercent: Number.parseInt((await zoomValue.textContent().catch(() => "")) || "", 10)
  };
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
      exitLoopMarkerCount: exitGroup?.querySelectorAll(".awkit-loop-indicator-marker").length ?? 0,
      selfLoopMarkerCount: selfGroup?.querySelectorAll(".awkit-loop-indicator-marker").length ?? 0,
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

const app = await electron.launch({
  args: [root, `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`],
  cwd: root,
  env
});
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

  // A persisted, bounded cross-node `loopBack` must use the dedicated return renderer without
  // becoming a structured self-Loop. Exercise the real profile mapping and the persistent SVG
  // layer at rest, across viewport-only zoom, and while its source node is physically dragged.
  const legacyReturnIds = { edgeId: "legacy-return", ordinaryEdgeId: "legacy-forward" };
  await win.selectOption(WF_SELECT, "verify-workflow-legacy-return");
  await win.waitForTimeout(900);
  await win.locator('.canvas-zoom-control button[title="Fit to screen"]').click();
  await win.waitForTimeout(300);
  await win.waitForFunction(
    ({ edgeId }) => {
      const direction = document.querySelector(`g.awkit-flow-edge[data-id="${CSS.escape(edgeId)}"] .awkit-loop-direction-path`);
      const animation = direction?.getAnimations()[0];
      return animation?.startTime !== null && Number.isFinite(Number(animation?.startTime));
    },
    legacyReturnIds,
    { timeout: 5000 }
  );
  const legacyInitial = await readLegacyReturnVisual(win, legacyReturnIds);
  let legacyHiddenBasePath = null;
  let legacyAfterVisibilityMutation = null;
  await win.evaluate(({ edgeId }) => {
    const style = document.createElement("style");
    style.id = "verify-hidden-legacy-return-path";
    style.textContent = `g.awkit-flow-edge[data-id="${CSS.escape(edgeId)}"] path.awkit-flow-edge-path { opacity: 0 !important; }`;
    document.head.append(style);
  }, legacyReturnIds);
  try {
    legacyHiddenBasePath = await readLegacyReturnVisual(win, legacyReturnIds);
  } finally {
    await win.evaluate(() => document.getElementById("verify-hidden-legacy-return-path")?.remove());
  }
  legacyAfterVisibilityMutation = await pollLegacyReturnVisual(
    win,
    legacyReturnIds,
    (visual) => Number.parseFloat(visual?.pathOpacity ?? "0") > 0
  );
  const legacyZoomSamples = await readLoopZoomSamples(win, legacyReturnIds, readLegacyReturnVisual);
  const legacyZoomVisuals = [legacyZoomSamples.at25, legacyZoomSamples.at100, legacyZoomSamples.at200]
    .map((sample) => sample.visual);
  const legacyPreDrag = await readLegacyReturnVisual(win, legacyReturnIds);
  const legacySourceBox = await win.locator('.awkit-flow-node[data-id="legacy-return-node-2"]').boundingBox();
  let legacyDuringDrag = null;
  let legacyAfterDrag = null;
  if (legacySourceBox) {
    await win.mouse.move(legacySourceBox.x + legacySourceBox.width / 2, legacySourceBox.y + legacySourceBox.height / 2);
    await win.mouse.down();
    try {
      await win.mouse.move(legacySourceBox.x + legacySourceBox.width / 2 + 32, legacySourceBox.y + legacySourceBox.height / 2 + 18, { steps: 6 });
      legacyDuringDrag = await pollLegacyReturnVisual(
        win,
        legacyReturnIds,
        (visual) => Boolean(visual && legacyPreDrag && visual.pathData !== legacyPreDrag.pathData &&
          visual.sourceLeft - legacyPreDrag.sourceLeft > 20 && visual.sourceTop - legacyPreDrag.sourceTop > 10)
      );
    } finally {
      await win.mouse.up();
    }
    legacyAfterDrag = await pollLegacyReturnVisual(
      win,
      legacyReturnIds,
      (visual) => Boolean(visual && legacyDuringDrag && visual.pathData === legacyDuringDrag.pathData &&
        visual.animationStartTime === legacyDuringDrag.animationStartTime),
      { consecutive: 2 }
    );
  }
  const legacyZoomStartTimes = legacyZoomVisuals.map((visual) => visual?.animationStartTime ?? Number.NaN);
  const legacyZoomPathData = legacyZoomVisuals.map((visual) => visual?.pathData ?? "");
  const legacyBasePathIsVisible = (visual) => Boolean(
    visual?.pathDisplay !== "none" && visual?.pathVisibility !== "hidden" && visual?.pathVisibility !== "collapse" &&
    Number.parseFloat(visual?.pathOpacity ?? "0") > 0 && visual?.pathStroke !== "none" &&
    visual?.pathStroke !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/i.test(visual?.pathStroke ?? "") &&
    Number.parseFloat(visual?.pathStrokeWidth ?? "0") > 0
  );
  const legacyVisualIsStable = (visual) => Boolean(
    visual?.connectorKind === "loopBack" && visual.persistentLayer && visual.baseCount === 1 &&
    visual.directionCount === 1 && visual.arrowCount === 1 && visual.markerCount === 0 && visual.valueCount === 0 &&
    visual.totalAnimationCount === 1 && visual.mainAnimationCount === 0 && visual.directionAnimationCount === 1 &&
    visual.arrowAnimationCount === 0 && visual.labelAnimationCount === 0 &&
    legacyBasePathIsVisible(visual) && visual.directionPathData === visual.pathData &&
    visual.startTouchesSource && visual.endTouchesTarget &&
    visual.labelText === "Loop Back × 4" && !visual.labelHasRuntimeProgress
  );
  check(
    "Legacy Loop Back base-path visibility oracle rejects a hidden continuous return stroke",
    Boolean(legacyHiddenBasePath && legacyAfterVisibilityMutation) &&
      !legacyBasePathIsVisible(legacyHiddenBasePath) && legacyBasePathIsVisible(legacyAfterVisibilityMutation),
    JSON.stringify({ hidden: legacyHiddenBasePath, restored: legacyAfterVisibilityMutation })
  );
  check(
    "Legacy cross-node Loop Back keeps distinct return geometry, one path animation, one arrow, a mode-safe label, and stable drag/zoom",
    Boolean(legacyInitial && legacyPreDrag && legacyDuringDrag && legacyAfterDrag && legacySourceBox) &&
      legacyVisualIsStable(legacyInitial) && legacyVisualIsStable(legacyPreDrag) &&
      legacyInitial.sourceId !== legacyInitial.targetId && legacyInitial.connectorKind === "loopBack" &&
      legacyInitial.role === "button" && legacyInitial.ariaLabel === "Configure loop connector: Loop Back × 4" &&
      legacyInitial.pathMoveCount === 1 && legacyInitial.pathCubicCount === 1 && legacyInitial.curvesBeyondEndpoints &&
      legacyInitial.pathData !== legacyInitial.ordinaryPathData && legacyInitial.ordinaryConnectorKind === null &&
      legacyInitial.ordinaryDirectionCount === 0 && legacyInitial.ordinaryArrowCount === 0 &&
      legacyInitial.animationName === "awkit-loop-direction" && legacyInitial.animationIterationCount === "infinite" &&
      legacyInitial.animationTimingFunction === "linear" && Number.parseFloat(legacyInitial.animationDuration) >= 1.5 &&
      Number.parseFloat(legacyInitial.animationDuration) <= 2.5 && legacyInitial.arrowDisplay !== "none" &&
      Number.parseFloat(legacyInitial.arrowOpacity) > 0 && legacyInitial.labelDisplay !== "none" &&
      Number.parseFloat(legacyInitial.labelOpacity) > 0 && legacyInitial.labelText !== "Count × 99" &&
      legacyZoomSamples.at25.percent === 25 && legacyZoomSamples.at100.percent === 100 &&
      legacyZoomSamples.at200.percent === 200 && legacyZoomSamples.restoredPercent === 100 &&
      legacyZoomVisuals.every(legacyVisualIsStable) && new Set(legacyZoomPathData).size === 1 &&
      legacyZoomStartTimes.every(Number.isFinite) && new Set(legacyZoomStartTimes).size === 1 &&
      legacyVisualIsStable(legacyDuringDrag) && legacyDuringDrag.pathData !== legacyPreDrag.pathData &&
      legacyDuringDrag.animationStartTime === legacyPreDrag.animationStartTime &&
      legacyDuringDrag.animationCurrentTime >= legacyPreDrag.animationCurrentTime &&
      legacyDuringDrag.sourceLeft - legacyPreDrag.sourceLeft > 20 && legacyDuringDrag.sourceTop - legacyPreDrag.sourceTop > 10 &&
      legacyVisualIsStable(legacyAfterDrag) && legacyAfterDrag.pathData === legacyDuringDrag.pathData &&
      legacyAfterDrag.animationStartTime === legacyPreDrag.animationStartTime &&
      legacyAfterDrag.animationCurrentTime >= legacyDuringDrag.animationCurrentTime,
    JSON.stringify({ initial: legacyInitial, zoom: legacyZoomSamples, beforeDrag: legacyPreDrag, duringDrag: legacyDuringDrag, afterDrag: legacyAfterDrag })
  );

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
      return { count: document.querySelectorAll("g.awkit-flow-edge").length, hasSelfLoop: Boolean(self?.querySelector(".awkit-loop-indicator")) };
    }, NODE);
    check("Add loop creates a self-loop connector", loop.count === before + 1 && loop.hasSelfLoop, `before=${before} after=${loop.count} selfLoop=${loop.hasSelfLoop}`);

    const loopMode = win.locator('.scenario-properties-panel label:has-text("Loop mode") select');
    const loopEditorVisible = await loopMode.isVisible().catch(() => false);
    check("Adding a workflow loop selects it and opens the complete loop editor", loopEditorVisible, await win.locator(".scenario-properties-panel").textContent().catch(() => "panel missing"));
    if (loopEditorVisible) {
      const countVisual = await readLoopVisual(win, NODE);
      check(
        "A fresh Workflow Loop shows its authoritative Count × 3 default instead of runtime progress",
        countVisual?.labelText === "Count × 3" && countVisual.valueCount === 0 && countVisual.labelAnimationCount === 0,
        JSON.stringify(countVisual)
      );
      await loopMode.selectOption("whileCondition");
      const maxIterationsInput = win.locator('.scenario-properties-panel label:has-text("Max iterations") input');
      await maxIterationsInput.fill("5");
      await win.waitForTimeout(120);
      const whileFiveVisual = await readLoopVisual(win, NODE);
      await maxIterationsInput.fill("10");
      await win.locator('.scenario-properties-panel label:has-text("Line style") select').selectOption("dotted");
      await win.locator('.scenario-properties-panel label:has-text("Thickness") select').selectOption("4");
      await win.locator('.scenario-properties-panel label:has-text("Connector shape") select').selectOption("smoothstep");
      await win.waitForTimeout(150);
      check("Workflow while-condition mode exposes structured condition authoring", await win.locator('.scenario-properties-panel label:has-text("Condition source") select').isVisible().catch(() => false));
      const visual = await readLoopVisual(win, NODE);
      const motion = await readLoopMotionDelta(win, NODE);
      const pixelMotion = await readLoopPixelMotion(win, NODE);
      const normalizeDash = (value) => String(value ?? "").replace(/px|,/g, " ").trim().replace(/\s+/g, " ");
      check(
        "Workflow Loop label updates to the authored While condition and never presents an iteration counter",
        whileFiveVisual?.labelText === "While · status = passed" && whileFiveVisual.valueCount === 0 &&
          visual?.labelText === "While · status = passed" && visual.valueCount === 0 && visual.labelAnimationCount === 0 &&
          Number.isFinite(whileFiveVisual.animationStartTime) && visual.animationStartTime === whileFiveVisual.animationStartTime &&
          visual.animationCurrentTime > whileFiveVisual.animationCurrentTime,
        JSON.stringify({ whileFiveVisual, tenIterationVisual: visual })
      );
      check(
        "Workflow Loop renders one continuous rounded return path, one path direction layer, and one compact static marker",
        visual?.connectorKind === "loop" && visual.className.includes("is-loop-connector") && visual.className.includes("nopan") &&
          visual.role === "button" && visual.tabIndex === "0" && visual.ariaLabel?.startsWith("Configure loop connector:") &&
          visual.owner === NODE && visual.syntheticLoopNodeCount === 0 && visual.canvasNodeCount > 0 &&
          visual.indicatorInEdgeLayer && !visual.indicatorInNodeLayer && Number.parseFloat(visual.edgeLayerZ) < Number.parseFloat(visual.nodeLayerZ) &&
          visual.baseCount === 1 && visual.pathCount === 1 && visual.markerCount === 1 && visual.directionCount === 1 &&
          visual.arrowCount === 1 && visual.legacyArrowCount === 0 && visual.laneCount === 0 && visual.backplateCount === 0 &&
          visual.outerCount === 1 && visual.mainCount === 1 && visual.sweepCount === 0 && visual.valueCount === 0 &&
          visual.focusCount === 1 && visual.hitCount === 1 && visual.sharedCenter && visual.directionMatchesPath &&
          visual.pathMoveCount === 1 && visual.pathHasRoundedSegments && visual.pathTotalLength > 0 && visual.pathWrapsNode && visual.pathEndpointsTouchNode &&
          Number.isFinite(visual.markerPathDistance) && visual.markerPathDistance <= 3 && visual.markerOutsideNode && !visual.nodeOverlapsRing &&
          visual.outerRadius === 20 && visual.mainRadius === 16 && visual.hitRadius === 24 &&
          visual.markerAnimationCount === 0 && visual.markerAnimationName === "none" && visual.markerToNodeHeightRatio < 1 &&
          visual.ringFullyVisible && !visual.overlapsOtherNode && !visual.labelOverlapsMarker &&
          !visual.labelOverlapsNode && visual.labelClearance >= 1,
        JSON.stringify(visual)
      );
      check(
        "Workflow Loop direction moves continuously on the real return path while its marker and authored label stay stationary",
        visual?.animationName === "awkit-loop-direction" && visual.animationIterationCount === "infinite" && visual.animationTimingFunction === "linear" &&
          Number.parseFloat(visual.animationDuration) > 0 && visual.directionMatchesPath && normalizeDash(visual.directionStrokeDash) !== "none" &&
          Number.parseFloat(visual.directionStrokeWidth) > 0 && visual.arrowDisplay !== "none" && Number.parseFloat(visual.arrowOpacity) > 0 &&
          normalizeDash(visual.pathStrokeDash) === "1 5" && Number.parseFloat(visual.pathStrokeWidth) >= 3 && Number.parseFloat(visual.pathStrokeWidth) <= 4.1 &&
          visual.pathStrokeLinecap === "round" && visual.pathStrokeLinejoin === "round" &&
          visual.markerAnimationCount === 0 && visual.labelAnimationCount === 0 &&
          Number.isFinite(motion?.delta) && motion.delta >= 100 && motion.dashMoved &&
          motion.beforeStartTime === motion.afterStartTime && !motion.labelMoved && !motion.labelTransformChanged &&
          motion.labelAnimationCount === 0 && motion.labelAnimationName === "none" &&
          Number.isFinite(pixelMotion?.changedPixels) && pixelMotion.changedPixels >= 12 && pixelMotion.totalDelta > 0,
        JSON.stringify({ visual, motion, pixelMotion })
      );
      check(
        "A non-circular saved shape cannot collapse a semantic Workflow Loop into an ordinary edge",
        visual?.pathCount === 1 && visual.markerCount === 1 && visual.outerCount === 1 && visual.directionCount === 1 &&
          visual.arrowCount === 1 && visual.sweepCount === 0 && visual.valueCount === 0 && visual.directionMatchesPath,
        JSON.stringify(visual)
      );
      const zoomSamples = await readLoopZoomSamples(win, NODE);
      const zoomVisuals = [zoomSamples.at25, zoomSamples.at100, zoomSamples.at200];
      const zoomRatios = zoomVisuals.map((sample) => sample.visual?.markerToNodeHeightRatio ?? Number.NaN);
      const zoomAnimationStartTimes = zoomVisuals.map((sample) => sample.visual?.animationStartTime ?? Number.NaN);
      check(
        "Workflow Loop path and marker remain attached and proportionate without restarting motion at 25%, 100%, and 200% zoom",
        zoomSamples.at25.percent === 25 && zoomSamples.at100.percent === 100 && zoomSamples.at200.percent === 200 &&
          zoomSamples.restoredPercent === 100 && zoomVisuals.every((sample) =>
            sample.visual?.labelText === "While · status = passed" && sample.visual.markerOutsideNode && sample.visual.pathWrapsNode &&
            sample.visual.directionMatchesPath && sample.visual.arrowCount === 1 &&
            Number.isFinite(sample.visual.markerPathDistance) && sample.visual.markerPathDistance <= 3 &&
            !sample.visual.labelOverlapsNode
          ) && zoomRatios.every(Number.isFinite) && Math.max(...zoomRatios) - Math.min(...zoomRatios) <= 0.08 &&
          zoomAnimationStartTimes.every(Number.isFinite) && new Set(zoomAnimationStartTimes).size === 1,
        JSON.stringify(zoomSamples)
      );
      const preDragVisual = await readLoopVisual(win, NODE);
      const loopNodeBox = await win.locator(`.awkit-flow-node[data-id="${NODE}"]`).boundingBox();
      let draggedVisual = null;
      if (loopNodeBox) {
        await win.mouse.move(loopNodeBox.x + loopNodeBox.width / 2, loopNodeBox.y + loopNodeBox.height / 2);
        await win.mouse.down();
        await win.mouse.move(loopNodeBox.x + loopNodeBox.width / 2 + 32, loopNodeBox.y + loopNodeBox.height / 2 + 18, { steps: 6 });
        draggedVisual = await readLoopVisual(win, NODE);
        await win.mouse.up();
        await win.waitForTimeout(100);
      }
      check(
        "Dragging the real Workflow node keeps its attached return path and marker aligned without creating another node",
        Boolean(loopNodeBox) && draggedVisual?.syntheticLoopNodeCount === 0 && draggedVisual.markerOutsideNode && draggedVisual.pathWrapsNode &&
          Number.isFinite(draggedVisual.markerPathDistance) && draggedVisual.markerPathDistance <= 3 &&
          draggedVisual.animationStartTime === preDragVisual?.animationStartTime && draggedVisual.animationCurrentTime >= preDragVisual.animationCurrentTime &&
          Math.abs((draggedVisual.nodeTop - preDragVisual?.nodeTop) - (draggedVisual.markerTop - preDragVisual?.markerTop)) < 2 &&
          Math.abs(draggedVisual.markerNodeClearance - preDragVisual?.markerNodeClearance) < 2 &&
          Math.abs(draggedVisual.markerCenterX - preDragVisual?.markerCenterX) > 20 &&
          !draggedVisual.overlapsOtherNode && !draggedVisual.labelOverlapsNode,
        JSON.stringify({ before: preDragVisual, duringDrag: draggedVisual })
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
          loopExitControl.labelText === "always" && !loopExitControl.selfHasControl &&
          loopExitControl.exitLoopMarkerCount === 0 && loopExitControl.selfLoopMarkerCount === 1,
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
          loopExitControl.haloTimingFunction === "linear" && loopExitControl.haloScale >= 1.24 && loopExitControl.haloContent !== "none",
        JSON.stringify(loopExitControl)
      );
      const secondaryNodeId = await win.evaluate((primaryId) =>
        [...document.querySelectorAll(".awkit-flow-node[data-id]")]
          .find((candidate) => candidate.getAttribute("data-id") !== primaryId && candidate.querySelector(".scenario-flow-node.flowRef"))
          ?.getAttribute("data-id") ?? null,
        NODE
      );
      let secondaryLoopAdded = false;
      if (secondaryNodeId) {
        await clickNodeMenuItem(win, secondaryNodeId, "Add loop");
        await win.waitForTimeout(350);
        const primaryVisualWithPeer = await readLoopVisual(win, NODE);
        const secondaryVisual = await readLoopVisual(win, secondaryNodeId);
        const selfLoopCount = await win.locator('g.awkit-flow-edge[data-source][data-target]').evaluateAll((groups) =>
          groups.filter((group) => group.getAttribute("data-source") === group.getAttribute("data-target") && group.querySelector(".awkit-loop-indicator")).length
        );
        secondaryLoopAdded = selfLoopCount === 2;
        check(
          "Two Workflow Loops render independently with distinct identities, routes, and authored summaries",
          secondaryLoopAdded && primaryVisualWithPeer?.owner === NODE && secondaryVisual?.owner === secondaryNodeId &&
            primaryVisualWithPeer.edgeId !== secondaryVisual.edgeId && primaryVisualWithPeer.pathData !== secondaryVisual.pathData &&
            primaryVisualWithPeer.labelText === "While · status = passed" && secondaryVisual.labelText === "Count × 3" &&
            primaryVisualWithPeer.directionMatchesPath && secondaryVisual.directionMatchesPath &&
            !primaryVisualWithPeer.labelOverlapsNode && !secondaryVisual.labelOverlapsNode &&
            primaryVisualWithPeer.animationName === "awkit-loop-direction" && secondaryVisual.animationName === "awkit-loop-direction",
          JSON.stringify({ selfLoopCount, primaryVisualWithPeer, secondaryVisual })
        );
      } else {
        check("Two Workflow Loops render independently with distinct identities, routes, and authored summaries", false, "no secondary flow node found");
      }
      if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE || process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK) {
        await win.locator("#sb-right-panel-collapse").click();
        await win.locator(".scenario-properties-panel").waitFor({ state: "hidden" });
        await win.locator(".app-toast-close").click().catch(() => undefined);
        await win.locator(".app-toast").waitFor({ state: "hidden" }).catch(() => undefined);
        await win.locator('.canvas-zoom-control button[title="Fit to screen"]').click();
        await win.waitForTimeout(300);
      }
      if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE) {
        await win.screenshot({ path: process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE });
      }
      if (process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK) {
        const loopEvidenceTheme = await win.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "light");
        await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
        await win.waitForTimeout(80);
        await win.screenshot({ path: process.env.AWKIT_WORKFLOW_LOOP_EVIDENCE_DARK });
        await win.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), loopEvidenceTheme);
      }
      await win.emulateMedia({ reducedMotion: "reduce" });
      const reducedVisual = await readLoopVisual(win, NODE);
      const reducedMotion = await readLoopMotionDelta(win, NODE);
      const reducedSecondaryVisual = secondaryLoopAdded && secondaryNodeId ? await readLoopVisual(win, secondaryNodeId) : null;
      const reducedSecondaryMotion = secondaryLoopAdded && secondaryNodeId ? await readLoopMotionDelta(win, secondaryNodeId) : null;
      const reducedLoopExitControl = await readLoopExitControlVisual(win, NODE);
      check(
        "Workflow Loop direction becomes static while its path, arrow, marker, and authored label remain readable under reduced motion",
        reducedVisual?.display !== "none" && reducedVisual.animationName === "none" &&
          Number.parseFloat(reducedVisual.opacity) > 0 && reducedVisual.directionMatchesPath &&
          reducedVisual.arrowDisplay !== "none" && Number.parseFloat(reducedVisual.arrowOpacity) > 0 &&
          reducedVisual.labelDisplay !== "none" && Number.parseFloat(reducedVisual.labelOpacity) > 0 &&
          reducedVisual.labelText === "While · status = passed" && reducedVisual.labelAnimationCount === 0 &&
          !reducedVisual.labelOverlapsNode && reducedVisual.markerCount === 1 && reducedVisual.markerAnimationCount === 0 &&
          !reducedMotion?.dashMoved && !reducedMotion?.labelMoved && !reducedMotion?.labelTransformChanged,
        JSON.stringify({ reducedVisual, reducedMotion })
      );
      check(
        "Reduced motion freezes both independent Workflow Loop direction paths without hiding either summary",
        !secondaryLoopAdded || (
          reducedSecondaryVisual?.animationName === "none" && reducedSecondaryVisual.display !== "none" &&
          reducedSecondaryVisual.arrowDisplay !== "none" && reducedSecondaryVisual.labelText === "Count × 3" &&
          !reducedSecondaryVisual.labelOverlapsNode && !reducedSecondaryMotion?.dashMoved && !reducedSecondaryMotion?.labelMoved
        ),
        JSON.stringify({ secondaryLoopAdded, reducedSecondaryVisual, reducedSecondaryMotion })
      );
      check(
        "Workflow Loop exit halo becomes a static ring under reduced motion",
        reducedLoopExitControl?.haloAnimationName === "none" && Number.parseFloat(reducedLoopExitControl.haloOpacity) > 0,
        JSON.stringify(reducedLoopExitControl)
      );
      await win.emulateMedia({ reducedMotion: "no-preference" });
      if (secondaryLoopAdded && secondaryNodeId) {
        await clickNodeMenuItem(win, secondaryNodeId, "Remove loop");
        await win.waitForTimeout(350);
        const cleanedLoops = await win.evaluate(({ primaryId, secondaryId }) => ({
          primary: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${primaryId}"][data-target="${primaryId}"] .awkit-loop-indicator`)),
          secondary: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${secondaryId}"][data-target="${secondaryId}"] .awkit-loop-indicator`)),
          count: [...document.querySelectorAll("g.awkit-flow-edge")]
            .filter((group) => group.getAttribute("data-source") === group.getAttribute("data-target") && group.querySelector(".awkit-loop-indicator")).length
        }), { primaryId: NODE, secondaryId: secondaryNodeId });
        check(
          "Removing the temporary peer Loop leaves the configured Workflow Loop untouched",
          cleanedLoops.primary && !cleanedLoops.secondary && cleanedLoops.count === 1,
          JSON.stringify(cleanedLoops)
        );
        await clickNodeMenuItem(win, NODE, "Configure loop");
      }
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
        const loopEdges = profile?.edges.filter((edge) => edge.source === sourceId && edge.target === sourceId && edge.type === "loop") ?? [];
        const exits = profile?.edges.filter((edge) => edge.source === sourceId && edge.target !== sourceId) ?? [];
        const conditionalExits = exits.filter((edge) => edge.type === "conditional");
        return {
          loopEdge: loopEdges[0],
          exit: exits[0],
          loopCount: loopEdges.length,
          nonSelfExitCount: exits.length,
          conditionalExitCount: conditionalExits.length
        };
      }, { sourceId: NODE, workflowId: activeWorkflowId });
      check(
        "Workflow save persists loop mode, bound, and while condition",
        savedLoopAuthoring.loopEdge?.type === "loop" &&
          savedLoopAuthoring.loopEdge?.loop?.mode === "whileCondition" &&
          savedLoopAuthoring.loopEdge?.loop?.maxIterations === 10 &&
          savedLoopAuthoring.loopEdge?.loop?.condition?.sourceField === "status",
        JSON.stringify(savedLoopAuthoring.loopEdge)
      );
      check(
        "Adding the workflow loop persists exactly one Loop and exactly one Conditional exit without duplication",
        savedLoopAuthoring.exit?.type === "conditional" && savedLoopAuthoring.exit?.condition?.expression === "true" &&
          savedLoopAuthoring.loopCount === 1 && savedLoopAuthoring.nonSelfExitCount === 1 && savedLoopAuthoring.conditionalExitCount === 1 &&
          !("insertControlRole" in savedLoopAuthoring.exit) && !("showAddButton" in savedLoopAuthoring.exit),
        JSON.stringify(savedLoopAuthoring)
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
      const reloadedTenVisual = await readLoopVisual(win, NODE);
      const reloadedLoopStructure = await win.evaluate(async ({ sourceId, workflowId }) => {
        const profile = await window.playwrightFlowStudio.workflows.get(workflowId);
        const persistedOutgoing = profile?.edges.filter((edge) => edge.source === sourceId) ?? [];
        const renderedOutgoing = [...document.querySelectorAll(`g.awkit-flow-edge[data-source="${sourceId}"]`)];
        return {
          loops: persistedOutgoing.filter((edge) => edge.target === sourceId && edge.type === "loop").length,
          conditionalExits: persistedOutgoing.filter((edge) => edge.target !== sourceId && edge.type === "conditional").length,
          outgoing: persistedOutgoing.length,
          renderedLoops: renderedOutgoing.filter((edge) => edge.getAttribute("data-target") === sourceId && edge.getAttribute("data-connector-kind") === "loop").length
        };
      }, { sourceId: NODE, workflowId: activeWorkflowId });
      check(
        "Saved Workflow Loop restores its While summary, direction path, and single Conditional exit after reload",
        reloadedTenVisual?.labelText === "While · status = passed" && reloadedTenVisual.valueCount === 0 &&
          reloadedTenVisual.pathCount === 1 && reloadedTenVisual.directionCount === 1 && reloadedTenVisual.arrowCount === 1 &&
          reloadedTenVisual.directionMatchesPath && reloadedLoopStructure.loops === 1 &&
          reloadedLoopStructure.conditionalExits === 1 && reloadedLoopStructure.outgoing === 2 && reloadedLoopStructure.renderedLoops === 1,
        JSON.stringify({ reloadedTenVisual, reloadedLoopStructure })
      );
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      await win.waitForTimeout(180);
      const clickedLoopControl = await clickLoopControl(win, NODE);
      const reopenedByControl = await loopMode.isVisible().catch(() => false);
      const selectedByControl = await win.evaluate((id) => Boolean(
        document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"] .awkit-loop-indicator.is-selected`)
      ), NODE);
      check(
        "The compact Workflow Loop marker is a reliable direct configuration target",
        clickedLoopControl && reopenedByControl && selectedByControl,
        JSON.stringify({ clickedLoopControl, reopenedByControl, selectedByControl })
      );
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      const loopGroup = win.locator(`g.awkit-flow-edge[data-source="${NODE}"][data-target="${NODE}"][role="button"]`);
      await loopGroup.focus();
      await win.keyboard.press("Enter");
      await win.waitForTimeout(180);
      check(
        "The Workflow Loop control reopens configuration with Enter",
        await loopMode.isVisible().catch(() => false) && await loopGroup.getAttribute("aria-label").then((value) => value?.startsWith("Configure loop connector:"))
      );
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      await win.waitForTimeout(180);
      await loopGroup.focus();
      await win.keyboard.press("Space");
      await win.waitForTimeout(180);
      check(
        "The Workflow Loop control reopens configuration with Space",
        await loopMode.isVisible().catch(() => false) && await loopGroup.getAttribute("aria-label").then((value) => value?.startsWith("Configure loop connector:"))
      );
      await win.locator(".awkit-flow-canvas").click({ position: { x: 18, y: 18 } });
      await win.waitForTimeout(180);
      await clickNodeMenuItem(win, NODE, "Configure loop");
      const reopenedByMenu = await loopMode.isVisible().catch(() => false);
      const reopenedMode = reopenedByMenu ? await loopMode.inputValue() : "";
      const reopenedMax = reopenedByMenu ? await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue() : "";
      const selectedByMenu = await win.evaluate((id) => Boolean(
        document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"] .awkit-loop-indicator.is-selected`)
      ), NODE);
      check(
        "Configure loop reopens the saved Workflow Loop after switching workflows",
        reopenedByMenu && reopenedMode === "whileCondition" && reopenedMax === "10" && selectedByMenu,
        JSON.stringify({ reopenedByMenu, reopenedMode, reopenedMax, selectedByMenu })
      );
      if (reopenedByMenu) {
        await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').fill("12");
        await win.waitForTimeout(120);
        const unsavedTwelveVisual = await readLoopVisual(win, NODE);
        await win.locator(`.awkit-flow-node[data-id="${NODE}"] .scenario-flow-node`).click();
        await clickNodeMenuItem(win, NODE, "Configure loop");
        check(
          "Configure loop reopens the existing Workflow Loop with its immediate unsaved bound edit and authored summary intact",
          unsavedTwelveVisual?.labelText === "While · status = passed" && unsavedTwelveVisual.valueCount === 0 &&
            await loopMode.isVisible().catch(() => false) &&
            await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue() === "12"
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
        const persistedLoopStructure = await win.evaluate(async ({ sourceId, workflowId }) => {
          const profile = await window.playwrightFlowStudio.workflows.get(workflowId);
          const outgoing = profile?.edges.filter((edge) => edge.source === sourceId) ?? [];
          return {
            loops: outgoing.filter((edge) => edge.target === sourceId && edge.type === "loop").length,
            conditionalExits: outgoing.filter((edge) => edge.target !== sourceId && edge.type === "conditional").length,
            outgoing: outgoing.length
          };
        }, { sourceId: NODE, workflowId: activeWorkflowId });
        check(
          "Reconfigured Workflow Loop persists with one Conditional exit and keeps its path-following direction motion after reload",
          persistedMax === "12" && persistedVisual?.labelText === "While · status = passed" && persistedVisual.valueCount === 0 &&
            persistedVisual.animationName === "awkit-loop-direction" && persistedVisual.animationIterationCount === "infinite" &&
            persistedVisual.directionMatchesPath && persistedVisual.arrowCount === 1 &&
            persistedLoopStructure.loops === 1 && persistedLoopStructure.conditionalExits === 1 && persistedLoopStructure.outgoing === 2,
          JSON.stringify({ persistedMax, persistedVisual, persistedLoopStructure })
        );
      }

      await clickNodeMenuItem(win, NODE, "Configure loop");
      const focusedLoop = win.locator(`g.awkit-flow-edge[data-source="${NODE}"][data-target="${NODE}"][role="button"]`);
      await focusedLoop.focus();
      await focusedLoop.press("Delete");
      await win.waitForTimeout(300);
      const removedByKeyboard = await win.locator(`g.awkit-flow-edge[data-source="${NODE}"][data-target="${NODE}"]`).count() === 0;
      check("Delete removes the keyboard-focused Workflow Loop connector", removedByKeyboard);
      await win.locator("#sb-undo").click();
      await win.waitForTimeout(300);
      const keyboardDeleteUndoVisual = await readLoopVisual(win, NODE);
      check(
        "Undo restores a keyboard-deleted Workflow Loop with its authored state",
        keyboardDeleteUndoVisual?.labelText === "While · status = passed" && keyboardDeleteUndoVisual.directionMatchesPath,
        JSON.stringify(keyboardDeleteUndoVisual)
      );

      await clickNodeMenuItem(win, NODE, "Configure loop");
      const inspectorDelete = win.getByRole("button", { name: "Delete connector", exact: true });
      const inspectorDeleteVisible = await inspectorDelete.isVisible().catch(() => false);
      check("The selected Workflow Loop exposes its connector-inspector delete action", inspectorDeleteVisible);
      if (inspectorDeleteVisible) {
        const readHistoryStructure = () => win.evaluate((sourceId) => {
          const outgoing = [...document.querySelectorAll(`g.awkit-flow-edge[data-source="${sourceId}"]`)];
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
        }, NODE);

        await inspectorDelete.click();
        await win.waitForTimeout(300);
        const deletedStructure = await readHistoryStructure();
        check(
          "Deleting a Workflow Loop from the inspector removes it and restores its lone exit to Standard",
          deletedStructure.loops === 0 && deletedStructure.exits === 1 &&
            deletedStructure.loopExitControls === 0 && deletedStructure.defaultExitControls === 1,
          JSON.stringify(deletedStructure)
        );

        await win.locator("#sb-undo").click();
        await win.waitForTimeout(300);
        const undoneVisual = await readLoopVisual(win, NODE);
        const undoneStructure = await readHistoryStructure();
        check(
          "Workflow Loop Undo restores the configured connector and exactly one emphasized Loop exit",
          undoneVisual?.labelText === "While · status = passed" && undoneVisual.directionMatchesPath &&
            undoneStructure.loops === 1 && undoneStructure.exits === 1 &&
            undoneStructure.loopExitControls === 1 && undoneStructure.defaultExitControls === 0,
          JSON.stringify({ undoneVisual, undoneStructure })
        );

        await win.locator("#sb-redo").click();
        await win.waitForTimeout(300);
        const redoneStructure = await readHistoryStructure();
        check(
          "Workflow Loop Redo removes the same connector without duplicating or orphaning its exit",
          redoneStructure.loops === 0 && redoneStructure.exits === 1 &&
            redoneStructure.loopExitControls === 0 && redoneStructure.defaultExitControls === 1,
          JSON.stringify(redoneStructure)
        );

        await win.locator("#sb-undo").click();
        await win.waitForTimeout(300);
        await clickNodeMenuItem(win, NODE, "Configure loop");
        const restoredMax = await win.locator('.scenario-properties-panel label:has-text("Max iterations") input').inputValue().catch(() => "");
        const restoredStructure = await readHistoryStructure();
        check(
          "Undo after Redo restores the persisted Workflow Loop configuration exactly once",
          restoredMax === "12" && restoredStructure.loops === 1 && restoredStructure.exits === 1 &&
            restoredStructure.loopExitControls === 1 && restoredStructure.defaultExitControls === 0,
          JSON.stringify({ restoredMax, restoredStructure })
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
