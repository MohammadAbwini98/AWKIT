import sharp from "sharp";

// Visual oracle for the structured Loop self-connector. The file keeps its historical
// "capsule" identifier (imported by the broad pre-capsule walkthroughs); the contract it pins is
// the approved Workflow Builder green dash-orbit bracket: one faint stationary base bracket, one
// bright marching dash overlay, and one orbiting dot with a soft halo riding the bracket path.
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
    const dash = indicator?.querySelector(".awkit-loop-indicator-dash");
    const marker = indicator?.querySelector(".awkit-loop-indicator-marker");
    const orbit = marker?.querySelector(".awkit-loop-indicator-orbit");
    const focus = marker?.querySelector(".awkit-loop-indicator-focus-ring");
    const hit = marker?.querySelector(".awkit-loop-indicator-hit");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));

    if (!(group instanceof SVGGElement) || !(node instanceof HTMLElement) || !(canvas instanceof HTMLElement) ||
      !(edgesLayer instanceof SVGElement) || !(nodesLayer instanceof HTMLElement) || !(indicator instanceof SVGGElement) ||
      !(path instanceof SVGPathElement) || !(dash instanceof SVGPathElement) || !(marker instanceof SVGGElement) ||
      !(orbit instanceof SVGCircleElement) || !(focus instanceof SVGCircleElement) ||
      !(hit instanceof SVGCircleElement) || !(label instanceof HTMLElement)) return null;

    const nodeRect = node.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const pathRect = path.getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    const orbitRect = orbit.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const pathStyle = getComputedStyle(path);
    const dashStyle = getComputedStyle(dash);
    const orbitStyle = getComputedStyle(orbit);
    const labelStyle = getComputedStyle(label);
    const edgeLayerStyle = getComputedStyle(edgesLayer);
    const nodeLayerStyle = getComputedStyle(nodesLayer);
    const dashAnimation = dash.getAnimations()[0];
    const orbitAnimation = orbit.getAnimations()[0];
    const visibleLayer = (style, rect) => style.display !== "none" &&
      style.visibility !== "hidden" && style.visibility !== "collapse" &&
      Number.parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
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

    const cx = Number(hit.getAttribute("cx"));
    const cy = Number(hit.getAttribute("cy"));
    const sharedHitCenter = [focus, hit].every((circle) =>
      Math.abs(Number(circle.getAttribute("cx")) - cx) < 0.01 &&
      Math.abs(Number(circle.getAttribute("cy")) - cy) < 0.01
    );

    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;
    const markerCenterX = hitRect.left + hitRect.width / 2;
    const markerCenterY = hitRect.top + hitRect.height / 2;
    const side = indicator.getAttribute("data-loop-side");
    const attachedLeft = side === "left" && Math.abs(pathRect.right - nodeRect.left) <= 3;
    const attachedRight = side === "right" && Math.abs(pathRect.left - nodeRect.right) <= 3;
    const laneAttachedToNode = attachedLeft || attachedRight;
    const markerOutsideNode = !overlaps(nodeRect, hitRect);
    const pathLength = path.getTotalLength();
    const matrix = path.getScreenCTM();
    let startPoint = null;
    let endPoint = null;
    let matrixNull = !matrix;
    let orbitOnPathDistance = Number.POSITIVE_INFINITY;
    if (matrix && pathLength > 0) {
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(pathLength);
      startPoint = new DOMPoint(start.x, start.y).matrixTransform(matrix);
      endPoint = new DOMPoint(end.x, end.y).matrixTransform(matrix);
      // The dot rides the bracket: compare its live position against the path point at the
      // animation's current offset-distance fraction.
      const orbitFraction = Number.parseFloat(orbitStyle.offsetDistance) / 100;
      if (Number.isFinite(orbitFraction)) {
        const expected = path.getPointAtLength(Math.min(1, Math.max(0, orbitFraction)) * pathLength);
        const expectedScreen = new DOMPoint(expected.x, expected.y).matrixTransform(matrix);
        orbitOnPathDistance = Math.hypot(
          orbitRect.left + orbitRect.width / 2 - expectedScreen.x,
          orbitRect.top + orbitRect.height / 2 - expectedScreen.y
        );
      }
    }
    const hitRadius = Number(hit.getAttribute("r"));
    // Screen-space geometry must be normalised by the live canvas zoom before comparing against the
    // design's user-unit constants — the hit circle's attribute radius gives the scale for free.
    const viewScale = hitRadius > 0 && hitRect.width > 0 ? hitRect.width / (2 * hitRadius) : 1;
    const bracketSpanUser = viewScale > 0 ? pathRect.height / viewScale : 0;
    const endpointSpanUser = startPoint && endPoint && viewScale > 0 ? Math.abs(startPoint.y - endPoint.y) / viewScale : 0;
    const nearSameSideBoundary = Boolean(startPoint && endPoint && (
      (Math.abs(startPoint.x - nodeRect.left) <= 4 && Math.abs(endPoint.x - nodeRect.left) <= 4) ||
      (Math.abs(startPoint.x - nodeRect.right) <= 4 && Math.abs(endPoint.x - nodeRect.right) <= 4)
    ));
    const verticallyCenteredAttachment = Boolean(startPoint && endPoint &&
      Math.abs((startPoint.y + endPoint.y) / 2 - nodeCenterY) <= 4 &&
      endpointSpanUser >= 44 * 0.8 &&
      endpointSpanUser <= 44 * 1.2);
    const pathWrapsWholeNode = pathRect.top < nodeRect.top - 2 && pathRect.bottom > nodeRect.bottom + 2;
    const bracketPathIsCompact = bracketSpanUser <= 44 + 3 && !pathWrapsWholeNode;
    const markerNodeClearance = Math.max(
      nodeRect.left - hitRect.right,
      hitRect.left - nodeRect.right,
      nodeRect.top - hitRect.bottom,
      hitRect.top - nodeRect.bottom
    );

    // Resolve the constant loop token through a probe so colors compare as computed rgb() strings.
    const probe = document.createElement("span");
    probe.style.color = "var(--awkit-connector-loop)";
    document.body.appendChild(probe);
    const loopTokenColor = getComputedStyle(probe).color;
    probe.remove();

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
      edgeLayerZ: edgeLayerStyle.zIndex,
      nodeLayerZ: nodeLayerStyle.zIndex,
      edgeBelowNode: Number.isFinite(Number.parseFloat(edgeLayerStyle.zIndex)) &&
        Number.isFinite(Number.parseFloat(nodeLayerStyle.zIndex)) &&
        Number.parseFloat(edgeLayerStyle.zIndex) < Number.parseFloat(nodeLayerStyle.zIndex),
      baseCount: group.querySelectorAll(".awkit-flow-edge-path").length,
      pathCount: group.querySelectorAll(".awkit-loop-indicator-path").length,
      dashCount: group.querySelectorAll(".awkit-loop-indicator-dash").length,
      markerCount: group.querySelectorAll(".awkit-loop-indicator-marker").length,
      orbitCount: group.querySelectorAll(".awkit-loop-indicator-orbit").length,
      focusCount: group.querySelectorAll(".awkit-loop-indicator-focus-ring").length,
      hitCount: group.querySelectorAll(".awkit-loop-indicator-hit").length,
      // Superseded capsule vocabulary stays at zero — a regression to any removed layer fails fast.
      laneCount: group.querySelectorAll(".awkit-loop-control-lane").length,
      backplateCount: group.querySelectorAll(".awkit-loop-control-backplate").length,
      outerCount: group.querySelectorAll(".awkit-loop-indicator-outer-ring").length,
      mainCount: group.querySelectorAll(".awkit-loop-indicator-main-ring").length,
      sweepCount: group.querySelectorAll(".awkit-loop-indicator-sweep").length,
      valueCount: group.querySelectorAll(".awkit-loop-indicator-value").length,
      directionCount: group.querySelectorAll(".awkit-loop-direction-path").length,
      arrowCount: group.querySelectorAll(".awkit-loop-indicator-arrow").length,
      hitRadius: Number(hit.getAttribute("r")),
      orbitRadius: Number(orbit.getAttribute("r")),
      sharedHitCenter,
      laneAttachedToNode,
      markerOutsideNode,
      markerNodeClearance,
      sameSideAttachment: nearSameSideBoundary && verticallyCenteredAttachment,
      endpointDiagnostics: {
        matrixNull,
        start: startPoint ? { x: startPoint.x, y: startPoint.y } : null,
        end: endPoint ? { x: endPoint.x, y: endPoint.y } : null,
        nodeLeft: nodeRect.left,
        nodeRight: nodeRect.right,
        nodeCenterY
      },
      bracketPathIsCompact,
      capsulePathIsCompact: bracketPathIsCompact,
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
      dashDisplay: dashStyle.display,
      dashVisibility: dashStyle.visibility,
      dashOpacity: dashStyle.opacity,
      dashStroke: dashStyle.stroke,
      dashWidth: dashStyle.strokeWidth,
      dashArray: dashStyle.strokeDasharray,
      dashLinecap: dashStyle.strokeLinecap,
      dashAnimationName: dashStyle.animationName,
      dashAnimationDuration: dashStyle.animationDuration,
      dashAnimationIterationCount: dashStyle.animationIterationCount,
      dashAnimationTimingFunction: dashStyle.animationTimingFunction,
      dashAnimationCount: dash.getAnimations().length,
      dashAnimationCurrentTime: Number(dashAnimation?.currentTime ?? Number.NaN),
      dashAnimationStartTime: Number(dashAnimation?.startTime ?? Number.NaN),
      orbitDisplay: orbitStyle.display,
      orbitVisibility: orbitStyle.visibility,
      orbitOpacity: orbitStyle.opacity,
      orbitFill: orbitStyle.fill,
      orbitStroke: orbitStyle.stroke,
      orbitStrokeOpacity: orbitStyle.strokeOpacity,
      orbitStrokeWidth: orbitStyle.strokeWidth,
      orbitOffsetPath: orbitStyle.offsetPath,
      orbitOffsetDistance: orbitStyle.offsetDistance,
      orbitAnimationName: orbitStyle.animationName,
      orbitAnimationDuration: orbitStyle.animationDuration,
      orbitAnimationIterationCount: orbitStyle.animationIterationCount,
      orbitAnimationTimingFunction: orbitStyle.animationTimingFunction,
      orbitAnimationCount: orbit.getAnimations().length,
      orbitAnimationCurrentTime: Number(orbitAnimation?.currentTime ?? Number.NaN),
      orbitOnPathDistance,
      orbitOnPath: orbitOnPathDistance <= 6,
      loopTokenColor,
      markerAnimationCount: marker.getAnimations().length,
      loopDomIdCount: loopDomIds.length,
      duplicateLoopDomIdCount,
      labelText: (label.textContent || "").trim(),
      labelTitle: label.getAttribute("title"),
      labelDisplay: labelStyle.display,
      labelOpacity: labelStyle.opacity,
      labelWidth: labelRect.width,
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
      markerLeft: hitRect.left,
      markerRight: hitRect.right,
      markerTop: hitRect.top,
      markerBottom: hitRect.bottom,
      markerCenterX,
      markerCenterY,
      hitDiameter: hitRect.width,
      markerToNodeHeightRatio: hitRect.height / nodeRect.height,
      controlFullyVisible: [pathRect, hitRect, labelRect].every((rect) =>
        rect.left >= canvasRect.left - 1 && rect.right <= canvasRect.right + 1 &&
        rect.top >= canvasRect.top - 1 && rect.bottom <= canvasRect.bottom + 1
      ),
      labelClearance: Math.max(
        hitRect.left - labelRect.right,
        labelRect.left - hitRect.right,
        hitRect.top - labelRect.bottom,
        labelRect.top - hitRect.bottom
      ),
      labelOverlapsMarker: overlaps(labelRect, hitRect),
      labelOverlapsNode: overlaps(labelRect, nodeRect),
      overlapsOtherNode: otherNodeRects.some((rect) => overlaps(rect, hitRect) || overlaps(rect, pathRect) || overlaps(rect, labelRect)),
      overlapsInsertControl: insertControlRects.some((rect) => overlaps(rect, hitRect) || overlaps(rect, pathRect) || overlaps(rect, labelRect)),
      selected: indicator.classList.contains("is-selected"),
      hitPointerEvents: getComputedStyle(hit).pointerEvents
    };
  }, nodeId);
}

const normalizeDash = (value) => String(value ?? "")
  .replace(/px|,/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export function matchesLoopCapsuleContract(visual, { owner } = {}) {
  return Boolean(
    visual?.connectorKind === "loop" &&
    visual.visualContract === "dash-orbit" &&
    (!owner || visual.owner === owner) &&
    visual.baseCount === 1 && visual.pathCount === 1 && visual.dashCount === 1 && visual.markerCount === 1 &&
    visual.orbitCount === 1 && visual.focusCount === 1 && visual.hitCount === 1 &&
    visual.laneCount === 0 && visual.backplateCount === 0 && visual.outerCount === 0 && visual.mainCount === 0 &&
    visual.sweepCount === 0 && visual.valueCount === 0 && visual.directionCount === 0 && visual.arrowCount === 0 &&
    visual.hitRadius === 22 && visual.orbitRadius === 4 && visual.sharedHitCenter &&
    visual.laneAttachedToNode && visual.sameSideAttachment && visual.markerOutsideNode &&
    visual.bracketPathIsCompact && !visual.pathWrapsWholeNode &&
    visual.pathMoveCount === 1 && visual.pathHasRoundedSegments && visual.pathTotalLength > 0 &&
    visual.pathDisplay !== "none" && visual.pathVisibility !== "hidden" && Number.parseFloat(visual.pathOpacity) > 0 &&
    Number.parseFloat(visual.pathOpacity) <= 0.6 && Number.parseFloat(visual.pathStrokeWidth) > 0 &&
    // The dash overlay is the bright moving layer: constant loop green, 2px, 7/21 marching round caps.
    // Animation wiring is deliberately NOT part of this base contract — the focused suites assert
    // running motion in normal mode and frozen motion under prefers-reduced-motion against the
    // same visual object.
    visual.dashStroke === visual.loopTokenColor && normalizeDash(visual.dashArray) === "7 21" &&
    Number.parseFloat(visual.dashWidth) === 2 && visual.dashLinecap === "round" &&
    // The orbit dot rides the bracket path with its soft halo stroke.
    visual.orbitFill === visual.loopTokenColor && Number.parseFloat(visual.orbitStrokeWidth) === 8 &&
    Number.parseFloat(visual.orbitStrokeOpacity) > 0 && Number.parseFloat(visual.orbitStrokeOpacity) <= 0.35 &&
    String(visual.orbitOffsetPath || "").includes("path(") && visual.orbitOnPath &&
    visual.syntheticLoopNodeCount === 0 && visual.indicatorInEdgeLayer && !visual.indicatorInNodeLayer &&
    visual.edgeBelowNode &&
    visual.role === "button" && visual.tabIndex === "0" &&
    typeof visual.ariaLabel === "string" && visual.ariaLabel.startsWith("Configure loop connector: ") &&
    visual.hitPointerEvents === "all" && visual.hitDiameter > 0 &&
    visual.dashDisplay !== "none" && Number.parseFloat(visual.dashOpacity) > 0 &&
    visual.orbitDisplay !== "none" && Number.parseFloat(visual.orbitOpacity) > 0 &&
    Number.parseFloat(visual.labelOpacity) > 0 && visual.labelWidth > 0 &&
    visual.labelTitle === visual.labelText && !visual.labelOverlapsMarker && !visual.labelOverlapsNode &&
    !visual.overlapsOtherNode && !visual.overlapsInsertControl && visual.labelClearance >= 0 &&
    visual.duplicateLoopDomIdCount === 0 &&
    visual.markerAnimationCount === 0 && visual.labelAnimationCount === 0
  );
}

export function rejectsLoopURouteHybrid(visual) {
  if (!matchesLoopCapsuleContract(visual)) return false;
  const knownBadMutations = [
    { ...visual, dashCount: 0 },
    { ...visual, orbitCount: 0 },
    { ...visual, markerCount: 0, focusCount: 0, hitCount: 0 },
    { ...visual, sweepCount: 1, valueCount: 1 },
    { ...visual, laneCount: 1, backplateCount: 1 },
    { ...visual, directionCount: 1, arrowCount: 1 },
    { ...visual, bracketPathIsCompact: false, pathWrapsWholeNode: true },
    { ...visual, sameSideAttachment: false },
    { ...visual, overlapsOtherNode: true },
    { ...visual, overlapsInsertControl: true },
    { ...visual, dashStroke: "rgb(29, 78, 216)" },
    { ...visual, orbitFill: "rgb(29, 78, 216)" },
    { ...visual, orbitOnPath: false },
    { ...visual, pathOpacity: "0.78" },
    { ...visual, pathOpacity: "0" },
    { ...visual, hitPointerEvents: "none" },
    { ...visual, hitDiameter: 0 },
    { ...visual, role: null },
    { ...visual, tabIndex: null },
    { ...visual, ariaLabel: null },
    { ...visual, labelTitle: null },
    { ...visual, labelWidth: 0 },
    { ...visual, edgeBelowNode: false }
  ];
  return knownBadMutations.every((mutation) => !matchesLoopCapsuleContract(mutation));
}

/** Wait for drawer/fit/viewport transitions to stop moving the whole graph before motion sampling. */
export async function waitForLoopCapsuleLayoutStable(win, nodeId, timeoutMs = 4000) {
  return win.evaluate(async ({ id, timeout }) => {
    const sample = () => {
      const group = document.querySelector(`g.awkit-flow-edge[data-source="${CSS.escape(id)}"][data-target="${CSS.escape(id)}"]`);
      const node = document.querySelector(`.awkit-flow-node[data-id="${CSS.escape(id)}"]`);
      const path = group?.querySelector(".awkit-loop-indicator-path");
      const hit = group?.querySelector(".awkit-loop-indicator-hit");
      const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
        .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
      if (!(node instanceof HTMLElement) || !(path instanceof SVGPathElement) ||
        !(hit instanceof SVGCircleElement) || !(label instanceof HTMLElement)) return null;
      return [node, path, hit, label].flatMap((element) => {
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
    const dash = group?.querySelector(".awkit-loop-indicator-dash");
    const orbit = group?.querySelector(".awkit-loop-indicator-orbit");
    const label = [...document.querySelectorAll(".awkit-loop-indicator-label")]
      .find((candidate) => candidate.getAttribute("data-edge-id") === group?.getAttribute("data-id"));
    if (!(dash instanceof SVGPathElement) || !(orbit instanceof SVGCircleElement) || !(label instanceof HTMLElement)) return null;
    const dashAnimation = dash.getAnimations()[0];
    const orbitAnimation = orbit.getAnimations()[0];
    const beforeTime = Number(dashAnimation?.currentTime ?? Number.NaN);
    const beforeDashOffset = getComputedStyle(dash).strokeDashoffset;
    const beforeOffset = getComputedStyle(orbit).offsetDistance;
    const beforeOrbitRect = orbit.getBoundingClientRect();
    const beforeLabelRect = label.getBoundingClientRect();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const afterTime = Number(dashAnimation?.currentTime ?? Number.NaN);
    const afterDashOffset = getComputedStyle(dash).strokeDashoffset;
    const afterOffset = getComputedStyle(orbit).offsetDistance;
    const afterOrbitRect = orbit.getBoundingClientRect();
    const afterLabelRect = label.getBoundingClientRect();
    const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const beforeOrbit = center(beforeOrbitRect);
    const afterOrbit = center(afterOrbitRect);
    const beforeLabel = center(beforeLabelRect);
    const afterLabel = center(afterLabelRect);
    return {
      beforeTime,
      afterTime,
      delta: afterTime - beforeTime,
      beforeStartTime: Number(dashAnimation?.startTime ?? Number.NaN),
      afterStartTime: Number(dashAnimation?.startTime ?? Number.NaN),
      orbitAnimationCount: orbit.getAnimations().length,
      orbitAnimationCurrentTime: Number(orbitAnimation?.currentTime ?? Number.NaN),
      beforeDashOffset,
      afterDashOffset,
      beforeOffset,
      afterOffset,
      dashMoved: beforeDashOffset !== afterDashOffset,
      orbitMoved: Math.hypot(afterOrbit.x - beforeOrbit.x, afterOrbit.y - beforeOrbit.y) > 0.5 || beforeOffset !== afterOffset,
      labelMoved: Math.hypot(afterLabel.x - beforeLabel.x, afterLabel.y - beforeLabel.y) > 0.5,
      labelAnimationCount: label.getAnimations().length
    };
  }, nodeId);
}

export async function readLoopCapsulePixelMotion(win, nodeId) {
  const path = win.locator(`g.awkit-flow-edge[data-source="${nodeId}"][data-target="${nodeId}"] .awkit-loop-indicator-path`);
  const bounds = await path.boundingBox();
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
    after.laneAttachedToNode && after.sameSideAttachment && after.bracketPathIsCompact;
}
