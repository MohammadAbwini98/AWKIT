import sharp from "sharp";

const close = (left, right, tolerance = 2) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

export async function readLoopCapsuleVisual(win, nodeId) {
  return win.evaluate((id) => {
    const group = document.querySelector(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"]`);
    const node = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(id)}"]`);
    const canvas = document.querySelector(".awkit-flow-canvas");
    const edgesLayer = group?.closest(".awkit-flow-edges");
    const nodesLayer = node?.closest(".awkit-flow-nodes");
    const indicator = group?.querySelector(".awkit-loop-indicator");
    const path = indicator?.querySelector(".awkit-loop-indicator-path");
    const lane = indicator?.querySelector(".awkit-loop-control-lane");
    const marker = indicator?.querySelector(".awkit-loop-indicator-marker");
    const backplate = marker?.querySelector(".awkit-loop-control-backplate");
    const outer = marker?.querySelector(".awkit-loop-indicator-outer-ring");
    const main = marker?.querySelector(".awkit-loop-indicator-main-ring");
    const sweep = marker?.querySelector(".awkit-loop-indicator-sweep");
    const value = marker?.querySelector(".awkit-loop-indicator-value");
    const focus = marker?.querySelector(".awkit-loop-indicator-focus-ring");
    const hit = marker?.querySelector(".awkit-loop-indicator-hit");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));

    if (!(group instanceof SVGGElement) || !(node instanceof HTMLElement) || !(canvas instanceof HTMLElement) ||
      !(edgesLayer instanceof SVGElement) || !(nodesLayer instanceof HTMLElement) || !(indicator instanceof SVGGElement) ||
      !(path instanceof SVGPathElement) || !(lane instanceof SVGRectElement) || !(marker instanceof SVGGElement) ||
      !(backplate instanceof SVGCircleElement) || !(outer instanceof SVGCircleElement) || !(main instanceof SVGCircleElement) ||
      !(sweep instanceof SVGCircleElement) || !(value instanceof SVGTextElement) || !(focus instanceof SVGCircleElement) ||
      !(hit instanceof SVGCircleElement) || !(label instanceof HTMLElement)) return null;

    const nodeRect = node.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const laneRect = lane.getBoundingClientRect();
    const pathRect = path.getBoundingClientRect();
    const outerRect = outer.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const pathStyle = getComputedStyle(path);
    const laneStyle = getComputedStyle(lane);
    const outerStyle = getComputedStyle(outer);
    const mainStyle = getComputedStyle(main);
    const sweepStyle = getComputedStyle(sweep);
    const sweepAnimation = sweep.getAnimations()[0];
    const valueStyle = getComputedStyle(value);
    const labelStyle = getComputedStyle(label);
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const otherNodeRects = [...document.querySelectorAll(".awkit-flow-node")]
      .filter((candidate) => candidate instanceof HTMLElement && candidate.getAttribute("data-id") !== id)
      .map((candidate) => candidate.getBoundingClientRect());
    const insertControlRects = [...document.querySelectorAll(".awkit-edge-add")]
      .filter((candidate) => candidate instanceof HTMLElement)
      .map((candidate) => candidate.getBoundingClientRect());
    const loopDomIds = [...document.querySelectorAll('g.awkit-flow-edge[data-source][data-target]')]
      .filter((candidate) => candidate.getAttribute("data-source") === candidate.getAttribute("data-target") && candidate.querySelector(".awkit-loop-indicator"))
      .flatMap((candidate) => [...candidate.querySelectorAll("[id]")].map((element) => element.id).filter(Boolean));
    const duplicateLoopDomIdCount = loopDomIds.length - new Set(loopDomIds).size;

    const cx = Number(outer.getAttribute("cx"));
    const cy = Number(outer.getAttribute("cy"));
    const sharedCenter = [backplate, main, sweep, focus, hit].every((circle) =>
      Math.abs(Number(circle.getAttribute("cx")) - cx) < 0.01 &&
      Math.abs(Number(circle.getAttribute("cy")) - cy) < 0.01
    ) && Math.abs(Number(value.getAttribute("x")) - cx) < 0.01 &&
      Math.abs(Number(value.getAttribute("y")) - cy) < 0.01;

    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;
    const markerCenterX = outerRect.left + outerRect.width / 2;
    const markerCenterY = outerRect.top + outerRect.height / 2;
    const side = indicator.getAttribute("data-loop-side");
    const attachedLeft = side === "left" && Math.abs(laneRect.right - nodeRect.left) <= 3;
    const attachedRight = side === "right" && Math.abs(laneRect.left - nodeRect.right) <= 3;
    const laneAttachedToNode = attachedLeft || attachedRight;
    const markerOutsideNode = !overlaps(nodeRect, outerRect);
    const pathLength = path.getTotalLength();
    const matrix = path.getScreenCTM();
    let startPoint = null;
    let endPoint = null;
    if (matrix && pathLength > 0) {
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(pathLength);
      startPoint = new DOMPoint(start.x, start.y).matrixTransform(matrix);
      endPoint = new DOMPoint(end.x, end.y).matrixTransform(matrix);
    }
    const nearSameSideBoundary = Boolean(startPoint && endPoint && (
      (Math.abs(startPoint.x - nodeRect.left) <= 4 && Math.abs(endPoint.x - nodeRect.left) <= 4) ||
      (Math.abs(startPoint.x - nodeRect.right) <= 4 && Math.abs(endPoint.x - nodeRect.right) <= 4)
    ));
    const verticallyCenteredAttachment = Boolean(startPoint && endPoint &&
      Math.abs((startPoint.y + endPoint.y) / 2 - nodeCenterY) <= 4 &&
      Math.abs(startPoint.y - endPoint.y) >= laneRect.height * 0.8 &&
      Math.abs(startPoint.y - endPoint.y) <= laneRect.height * 1.2);
    const pathWrapsWholeNode = pathRect.top < nodeRect.top - 2 && pathRect.bottom > nodeRect.bottom + 2;
    const capsulePathIsCompact = pathRect.height <= laneRect.height + 3 && !pathWrapsWholeNode;
    const ringCenteredOnLane = Math.abs(markerCenterX - (laneRect.left + laneRect.width / 2)) <= 2 &&
      Math.abs(markerCenterY - (laneRect.top + laneRect.height / 2)) <= 2;
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
      side,
      visualContract: indicator.getAttribute("data-loop-visual"),
      canvasNodeCount: document.querySelectorAll("[data-canvas-node]").length,
      syntheticLoopNodeCount: document.querySelectorAll('[data-canvas-node][data-loop-indicator], [data-canvas-node^="loop-visual-"]').length,
      indicatorInEdgeLayer: Boolean(indicator.closest(".awkit-flow-edges")),
      indicatorInNodeLayer: Boolean(indicator.closest(".awkit-flow-nodes")),
      edgeLayerZ: getComputedStyle(edgesLayer).zIndex,
      nodeLayerZ: getComputedStyle(nodesLayer).zIndex,
      baseCount: group.querySelectorAll(".awkit-flow-edge-path").length,
      pathCount: group.querySelectorAll(".awkit-loop-indicator-path").length,
      laneCount: group.querySelectorAll(".awkit-loop-control-lane").length,
      markerCount: group.querySelectorAll(".awkit-loop-indicator-marker").length,
      backplateCount: group.querySelectorAll(".awkit-loop-control-backplate").length,
      outerCount: group.querySelectorAll(".awkit-loop-indicator-outer-ring").length,
      mainCount: group.querySelectorAll(".awkit-loop-indicator-main-ring").length,
      sweepCount: group.querySelectorAll(".awkit-loop-indicator-sweep").length,
      valueCount: group.querySelectorAll(".awkit-loop-indicator-value").length,
      focusCount: group.querySelectorAll(".awkit-loop-indicator-focus-ring").length,
      hitCount: group.querySelectorAll(".awkit-loop-indicator-hit").length,
      directionCount: group.querySelectorAll(".awkit-loop-direction-path").length,
      arrowCount: group.querySelectorAll(".awkit-loop-indicator-arrow").length,
      laneWidth: Number(lane.getAttribute("width")),
      laneHeight: Number(lane.getAttribute("height")),
      laneRadius: Number(lane.getAttribute("rx")),
      outerRadius: Number(outer.getAttribute("r")),
      mainRadius: Number(main.getAttribute("r")),
      hitRadius: Number(hit.getAttribute("r")),
      sharedCenter,
      ringCenteredOnLane,
      laneAttachedToNode,
      markerOutsideNode,
      markerNodeClearance,
      sameSideAttachment: nearSameSideBoundary && verticallyCenteredAttachment,
      capsulePathIsCompact,
      pathWrapsWholeNode,
      pathData: path.getAttribute("d") || "",
      pathMoveCount: ((path.getAttribute("d") || "").match(/[Mm]/g) || []).length,
      pathHasRoundedSegments: /[QqCcAa]/.test(path.getAttribute("d") || ""),
      pathTotalLength: pathLength,
      pathStrokeDash: path.style.strokeDasharray || pathStyle.strokeDasharray,
      pathStrokeWidth: pathStyle.strokeWidth,
      pathStrokeLinecap: pathStyle.strokeLinecap,
      pathStrokeLinejoin: pathStyle.strokeLinejoin,
      pathDisplay: pathStyle.display,
      pathVisibility: pathStyle.visibility,
      pathOpacity: pathStyle.opacity,
      pathStroke: pathStyle.stroke,
      laneDisplay: laneStyle.display,
      laneVisibility: laneStyle.visibility,
      laneOpacity: laneStyle.opacity,
      outerDisplay: outerStyle.display,
      outerVisibility: outerStyle.visibility,
      outerOpacity: outerStyle.opacity,
      mainDisplay: mainStyle.display,
      mainVisibility: mainStyle.visibility,
      mainOpacity: mainStyle.opacity,
      sweepDisplay: sweepStyle.display,
      sweepVisibility: sweepStyle.visibility,
      sweepOpacity: sweepStyle.opacity,
      sweepPathLength: sweep.getAttribute("pathLength"),
      sweepDash: sweep.style.strokeDasharray || sweepStyle.strokeDasharray,
      sweepWidth: sweepStyle.strokeWidth,
      sweepLinecap: sweepStyle.strokeLinecap,
      animationName: sweepStyle.animationName,
      animationDuration: sweepStyle.animationDuration,
      animationIterationCount: sweepStyle.animationIterationCount,
      animationTimingFunction: sweepStyle.animationTimingFunction,
      animationTransform: sweepStyle.transform,
      sweepAnimationCount: sweep.getAnimations().length,
      sweepAnimationCurrentTime: Number(sweepAnimation?.currentTime ?? Number.NaN),
      sweepAnimationStartTime: Number(sweepAnimation?.startTime ?? Number.NaN),
      markerAnimationCount: marker.getAnimations().length,
      loopDomIdCount: loopDomIds.length,
      duplicateLoopDomIdCount,
      valueText: (value.textContent || "").trim(),
      valueDisplay: valueStyle.display,
      valueOpacity: valueStyle.opacity,
      valueAnimationName: valueStyle.animationName,
      valueAnimationCount: value.getAnimations().length,
      valueCenteredOnRing: Math.abs(valueRect.left + valueRect.width / 2 - markerCenterX) <= 2 &&
        Math.abs(valueRect.top + valueRect.height / 2 - markerCenterY) <= Math.max(4, valueRect.height * 0.35),
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
      nodeCenterX,
      nodeCenterY,
      markerLeft: outerRect.left,
      markerRight: outerRect.right,
      markerTop: outerRect.top,
      markerBottom: outerRect.bottom,
      markerCenterX,
      markerCenterY,
      outerDiameter: outerRect.width,
      mainDiameter: mainRect.width,
      hitDiameter: hitRect.width,
      markerToNodeHeightRatio: outerRect.height / nodeRect.height,
      ringFullyVisible: outerRect.left >= canvasRect.left - 1 && outerRect.right <= canvasRect.right + 1 &&
        outerRect.top >= canvasRect.top - 1 && outerRect.bottom <= canvasRect.bottom + 1 && labelRect.top >= canvasRect.top - 1,
      controlFullyVisible: [laneRect, hitRect, labelRect].every((rect) =>
        rect.left >= canvasRect.left - 1 && rect.right <= canvasRect.right + 1 &&
        rect.top >= canvasRect.top - 1 && rect.bottom <= canvasRect.bottom + 1
      ),
      labelClearance: Math.max(
        outerRect.left - labelRect.right,
        labelRect.left - outerRect.right,
        outerRect.top - labelRect.bottom,
        labelRect.top - outerRect.bottom
      ),
      labelOverlapsMarker: overlaps(labelRect, outerRect),
      labelOverlapsNode: overlaps(labelRect, nodeRect),
      overlapsOtherNode: otherNodeRects.some((rect) => overlaps(rect, hitRect) || overlaps(rect, outerRect) || overlaps(rect, laneRect) || overlaps(rect, labelRect)),
      overlapsInsertControl: insertControlRects.some((rect) => overlaps(rect, hitRect) || overlaps(rect, laneRect) || overlaps(rect, labelRect)),
      selected: indicator.classList.contains("is-selected"),
      hitPointerEvents: getComputedStyle(hit).pointerEvents
    };
  }, nodeId);
}

export function matchesLoopCapsuleContract(visual, { owner, value } = {}) {
  return Boolean(
    visual?.connectorKind === "loop" &&
    visual.visualContract === "capsule-ring" &&
    (!owner || visual.owner === owner) &&
    visual.baseCount === 1 && visual.pathCount === 1 && visual.laneCount === 1 && visual.markerCount === 1 &&
    visual.backplateCount === 1 && visual.outerCount === 1 && visual.mainCount === 1 && visual.sweepCount === 1 &&
    visual.valueCount === 1 && visual.focusCount === 1 && visual.hitCount === 1 &&
    visual.directionCount === 0 && visual.arrowCount === 0 &&
    visual.laneWidth === 160 && visual.laneHeight === 20 && visual.laneRadius === 10 &&
    visual.outerRadius === 40 && visual.mainRadius === 30 && visual.hitRadius === 44 &&
    visual.sharedCenter && visual.ringCenteredOnLane && visual.laneAttachedToNode && visual.sameSideAttachment &&
    visual.markerOutsideNode && visual.capsulePathIsCompact && !visual.pathWrapsWholeNode &&
    visual.pathMoveCount === 1 && visual.pathHasRoundedSegments && visual.pathTotalLength > 0 &&
    visual.valueCenteredOnRing && (value === undefined || visual.valueText === String(value)) &&
    visual.syntheticLoopNodeCount === 0 && visual.indicatorInEdgeLayer && !visual.indicatorInNodeLayer &&
    visual.role === "button" && visual.tabIndex === "0" && visual.hitPointerEvents === "all" &&
    visual.pathDisplay !== "none" && visual.pathVisibility !== "hidden" && Number.parseFloat(visual.pathOpacity) > 0 &&
    visual.pathStroke !== "none" && Number.parseFloat(visual.pathStrokeWidth) > 0 &&
    visual.laneDisplay !== "none" && visual.laneVisibility !== "hidden" && Number.parseFloat(visual.laneOpacity) > 0 &&
    visual.outerDisplay !== "none" && visual.outerVisibility !== "hidden" && Number.parseFloat(visual.outerOpacity) > 0 &&
    visual.mainDisplay !== "none" && visual.mainVisibility !== "hidden" && Number.parseFloat(visual.mainOpacity) > 0 &&
    visual.sweepDisplay !== "none" && visual.sweepVisibility !== "hidden" && Number.parseFloat(visual.sweepOpacity) > 0 &&
    !visual.labelOverlapsMarker && !visual.labelOverlapsNode && !visual.overlapsOtherNode && !visual.overlapsInsertControl &&
    visual.duplicateLoopDomIdCount === 0 &&
    visual.markerAnimationCount === 0 && visual.valueAnimationCount === 0 && visual.labelAnimationCount === 0
  );
}

export function rejectsLoopURouteHybrid(visual) {
  if (!matchesLoopCapsuleContract(visual)) return false;
  const knownBadMutations = [
    { ...visual, laneCount: 0 },
    { ...visual, backplateCount: 0, sweepCount: 0, valueCount: 0 },
    { ...visual, capsulePathIsCompact: false, pathWrapsWholeNode: true },
    { ...visual, directionCount: 1, arrowCount: 1 },
    { ...visual, overlapsOtherNode: true },
    { ...visual, overlapsInsertControl: true }
  ];
  return knownBadMutations.every((mutation) => !matchesLoopCapsuleContract(mutation));
}

/** Wait for drawer/fit/viewport transitions to stop moving the whole graph before motion sampling. */
export async function waitForLoopCapsuleLayoutStable(win, nodeId, timeoutMs = 4000) {
  return win.evaluate(async ({ id, timeout }) => {
    const sample = () => {
      const group = document.querySelector(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"]`);
      const node = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(id)}"]`);
      const lane = group?.querySelector(".awkit-loop-control-lane");
      const hit = group?.querySelector(".awkit-loop-indicator-hit");
      const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
        .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
      if (!(node instanceof HTMLElement) || !(lane instanceof SVGRectElement) ||
        !(hit instanceof SVGCircleElement) || !(label instanceof HTMLElement)) return null;
      return [node, lane, hit, label].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height];
      });
    };
    const deadline = performance.now() + timeout;
    let previous = null;
    let stableFrames = 0;
    while (performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const current = sample();
      if (!current) {
        stableFrames = 0;
        previous = null;
        continue;
      }
      const stable = previous?.length === current.length && current.every((value, index) => Math.abs(value - previous[index]) <= 0.2);
      stableFrames = stable ? stableFrames + 1 : 0;
      if (stableFrames >= 3) return true;
      previous = current;
    }
    return false;
  }, { id: nodeId, timeout: timeoutMs });
}

export async function readLoopCapsuleMotion(win, nodeId) {
  return win.evaluate(async (id) => {
    const group = document.querySelector(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"]`);
    const sweep = group?.querySelector(".awkit-loop-indicator-sweep");
    const value = group?.querySelector(".awkit-loop-indicator-value");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
    if (!(sweep instanceof SVGCircleElement) || !(value instanceof SVGTextElement) || !(label instanceof HTMLElement)) return null;
    const animation = sweep.getAnimations()[0];
    const beforeTime = Number(animation?.currentTime ?? Number.NaN);
    const beforeStartTime = Number(animation?.startTime ?? Number.NaN);
    const beforeTransform = getComputedStyle(sweep).transform;
    const beforeValueRect = value.getBoundingClientRect();
    const beforeLabelRect = label.getBoundingClientRect();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const afterTime = Number(animation?.currentTime ?? Number.NaN);
    const afterStartTime = Number(animation?.startTime ?? Number.NaN);
    const afterTransform = getComputedStyle(sweep).transform;
    const afterValueRect = value.getBoundingClientRect();
    const afterLabelRect = label.getBoundingClientRect();
    const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const beforeValue = center(beforeValueRect);
    const afterValue = center(afterValueRect);
    const beforeLabel = center(beforeLabelRect);
    const afterLabel = center(afterLabelRect);
    return {
      beforeTime,
      afterTime,
      delta: afterTime - beforeTime,
      beforeStartTime,
      afterStartTime,
      beforeTransform,
      afterTransform,
      moved: beforeTransform !== afterTransform,
      valueMoved: Math.hypot(afterValue.x - beforeValue.x, afterValue.y - beforeValue.y) > 0.5,
      labelMoved: Math.hypot(afterLabel.x - beforeLabel.x, afterLabel.y - beforeLabel.y) > 0.5,
      valueAnimationCount: value.getAnimations().length,
      labelAnimationCount: label.getAnimations().length
    };
  }, nodeId);
}

export async function readLoopCapsulePixelMotion(win, nodeId) {
  const sweep = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-sweep`);
  const bounds = await sweep.boundingBox();
  if (!bounds) return null;
  const clip = {
    x: Math.max(0, Math.floor(bounds.x - 5)),
    y: Math.max(0, Math.floor(bounds.y - 5)),
    width: Math.ceil(bounds.width + 10),
    height: Math.ceil(bounds.height + 10)
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
    const delta = Math.abs(first.data[offset] - second.data[offset]) +
      Math.abs(first.data[offset + 1] - second.data[offset + 1]) +
      Math.abs(first.data[offset + 2] - second.data[offset + 2]);
    totalDelta += delta;
    if (delta >= 24) changedPixels += 1;
  }
  return { changedPixels, totalDelta, width: first.info.width, height: first.info.height };
}

export function loopCapsuleMovedWithNode(before, after, tolerance = 2) {
  if (!before || !after) return false;
  const nodeDx = after.nodeLeft - before.nodeLeft;
  const nodeDy = after.nodeTop - before.nodeTop;
  return close(after.markerLeft - before.markerLeft, nodeDx, tolerance) &&
    close(after.markerTop - before.markerTop, nodeDy, tolerance) &&
    close(after.markerNodeClearance, before.markerNodeClearance, tolerance) &&
    after.laneAttachedToNode && after.sameSideAttachment && after.capsulePathIsCompact;
}
