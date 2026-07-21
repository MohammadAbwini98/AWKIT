/**
 * Flow Designer ↔ `FlowProfile` mapping.
 *
 * These functions are the persistence boundary of the Flow Designer: `fromFlowStep`/`createEdge`
 * build the canvas document from a saved profile, and `toFlowProfile`/`toFlowStep`/`toNodeConfig`/
 * `createValueSource` build the saved profile back from the canvas document. Round-trip fidelity of
 * a saved flow is decided entirely here.
 *
 * They live in their own module (rather than inside `pages/FlowChartDesigner.tsx`) so they can be
 * exercised headlessly — a 1300-line page component cannot be imported by a `tsx` verifier.
 * `scripts/verify-random-roundtrip.mts` drives them directly, and `FlowChartDesigner.tsx` is now
 * the only other consumer.
 *
 * **This is the single source of the mapping.** It was extracted verbatim from the designer page,
 * so a change here changes what gets persisted — see the catalogued round-trip defects in
 * `src/testing/roundtrip/RoundTripDefectCatalog.ts` before editing.
 */
import type {
  EdgeVisualStyle,
  FlowEdgeType,
  FlowProfile,
  FlowStep,
  NodeConfig,
  ValueSource,
  ValueSourceType
} from "@src/profiles/FlowProfile";
import type { CanvasEdge, CanvasNode } from "../canvas/types";
import { buildConnectorVisual, hasCustomStyle } from "../shared/connectorStyle";
import type { FlowConnectionData } from "./ConnectionPropertiesPanel";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  defaultNodeData,
  defaultOracleNodeConfig,
  type FlowDesignerNodeData
} from "./flowDesignerTypes";
import { getFlowNodeCatalogItem } from "./flowNodeCatalog";

export type FlowDesignerNode = CanvasNode<FlowDesignerNodeData>;
export type FlowDesignerEdge = CanvasEdge<FlowConnectionData>;

export function createEdge(
  source: string,
  target: string,
  linkType: FlowEdgeType,
  label?: string,
  expression?: string,
  style?: EdgeVisualStyle,
  maxLoopCount?: number,
  extra?: Partial<FlowConnectionData>
): FlowDesignerEdge {
  const resolvedLabel = label ?? linkType;
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    ...buildConnectorVisual(linkType, style),
    data: { linkType, label: resolvedLabel, expression: expression ?? "", style, maxLoopCount, ...extra },
    label: resolvedLabel
  };
}

export function toFlowProfile(nodes: FlowDesignerNode[], edges: FlowDesignerEdge[], id: string, name: string): FlowProfile {
  return {
    id,
    name,
    description: "Editable reusable flow",
    version: 1,
    nodes: nodes.map((node) => toFlowStep(node, edges)),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.linkType ?? "success",
      kind: edge.data?.kind,
      conditional: edge.data?.kind === "conditional" ? edge.data?.conditional : undefined,
      parallel: edge.data?.kind === "parallel" ? edge.data?.parallel : undefined,
      loop: edge.data?.kind === "loop" ? edge.data?.loop : undefined,
      label: edge.data?.label,
      condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
      style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined,
      maxLoopCount: edge.data?.linkType === "loopBack" ? edge.data?.maxLoopCount ?? 2 : undefined
    }))
  };
}

export function toFlowStep(node: FlowDesignerNode, edges: FlowDesignerEdge[]): FlowStep {
  const data = node.data;
  const catalogItem = getFlowNodeCatalogItem(data.stepType);
  const next = edges.find((edge) => edge.source === node.id)?.target;
  const valueSource = createValueSource(data);

  return {
    id: node.id,
    type: data.stepType,
    name: data.name,
    description: data.description,
    position: node.position,
    next,
    locator: catalogItem.requiresLocator
      ? {
        strategy: data.locatorStrategy,
        value: data.locatorValue,
        name: data.locatorName || undefined,
        exact: data.locatorExact || undefined,
        quality: data.locatorQuality,
        // Keep the Recorder's runtime fallbacks + container/frame scoping on save.
        alternatives: data.locatorAlternatives,
        context: data.locatorContext
      }
      : undefined,
    value: data.value || undefined,
    valueSource,
    // `|| undefined` so a goto with no literal (its value comes from a source) does not persist `url: ""`.
    url: data.stepType === "goto" ? data.value || undefined : undefined,
    timeoutMs: data.timeoutMs,
    beforeWaits: data.beforeWaits?.length ? data.beforeWaits : undefined,
    afterWaits: data.afterWaits?.length ? data.afterWaits : undefined,
    retry: {
      count: data.retryCount,
      delayMs: data.retryDelayMs
    },
    onFailure: {
      action: data.failureAction,
      screenshot: data.screenshotOnFailure
    },
    outputs: data.outputKey ? { [data.outputKey]: { type: "text" } } : undefined,
    selectionMode: data.stepType === "select" ? data.selectionMode : undefined,
    flowId: data.stepType === "runFlow" ? data.targetFlowId || undefined : undefined,
    size: { width: Math.round(data.width), height: Math.round(data.height) },
    config: toNodeConfig(data)
  };
}

export function toNodeConfig(data: FlowDesignerNodeData): NodeConfig {
  return {
    clearBeforeFill: data.clearBeforeFill,
    selectMultiple: data.selectMultiple,
    waitType: data.waitType,
    assertionType: data.assertionType,
    comparisonOperator: data.comparisonOperator,
    expectedValue: data.expectedValue || undefined,
    screenshotName: data.screenshotName || undefined,
    fullPage: data.fullPage,
    scrollTarget: data.scrollTarget,
    scrollDirection: data.scrollDirection,
    scrollAmount: data.scrollAmount,
    loopType: data.loopType,
    iterationCount: data.iterationCount,
    loopActionType: data.loopActionType,
    loopStopOnFailure: data.loopStopOnFailure,
    maxIterations: data.maxIterations,
    targetFlowId: data.targetFlowId || undefined,
    stopParentOnChildFailure: data.stopParentOnChildFailure,
    routeMode: data.stepType === "routeChange" ? data.routeMode : undefined,
    urlMatch: data.stepType === "routeChange" ? data.urlMatch : undefined,
    routeWaitUntil: data.stepType === "routeChange" ? data.routeWaitUntil : undefined,
    sessionName: data.stepType === "saveSession" ? data.sessionName || undefined : undefined,
    sessionFolder: data.stepType === "saveSession" ? data.sessionFolder || undefined : undefined,
    overwriteSession: data.stepType === "saveSession" ? data.overwriteSession : undefined,
    captureScope: data.stepType === "saveSession" ? data.captureScope : undefined,
    maskSession: data.stepType === "saveSession" ? data.maskSession : undefined,
    loginProvider: data.stepType === "protectedLoginHandoff" ? data.loginProvider : undefined,
    handoffMode: data.stepType === "protectedLoginHandoff" ? data.handoffMode : undefined,
    handoffInstructions: data.stepType === "protectedLoginHandoff" ? data.handoffInstructions || undefined : undefined,
    allowRetry: data.stepType === "protectedLoginHandoff" ? data.allowRetry : undefined,
    handoffTimeoutMs: data.stepType === "protectedLoginHandoff" ? data.handoffTimeoutMs : undefined,
    detectBeforeHandoff: data.stepType === "protectedLoginHandoff" ? data.detectBeforeHandoff : undefined,
    reuseSessionMode: data.stepType === "reuseSession" ? data.reuseSessionMode : undefined,
    reuseSessionId: data.stepType === "reuseSession" && data.reuseSessionMode === "selected" ? data.reuseSessionId || undefined : undefined,
    oracle: data.stepType === "oracle" ? data.oracle : undefined
  };
}

/** The two source kinds the properties panel can actually author. */
function isDesignerAuthorable(type: ValueSourceType): boolean {
  return type === "static" || type === "dynamic";
}

/**
 * Rebuild the step's value source from designer state.
 *
 * Only `static` and `dynamic` are reconstructed, because those are the only two the properties
 * panel can author. Every other kind is **passed through verbatim** from `valueSourceOriginal`.
 *
 * This used to rebuild all nine kinds from the single `data.value` string, which silently corrupted
 * them: an `env` source came back with a URL as its `envKey`, a `generated` source came back with a
 * `generator` outside its own union, and `secret`/`dynamic` were dropped entirely because their
 * discriminating field never made it into that string. Preserving the source is both correct and
 * simpler — the designer has no UI to edit these, so it has no business re-deriving them.
 */
export function createValueSource(data: FlowDesignerNodeData): ValueSource | undefined {
  if (data.valueSourceType === "dynamic") {
    return {
      type: "dynamic",
      dataSourceScope: data.dataSourceScope,
      dataSourceId: data.dataSourceScope === "specific" ? data.dataSourceId || undefined : undefined,
      idMode: data.idMode,
      objectId: data.idMode === "explicit" ? data.objectId || undefined : undefined,
      keyName: data.keyName || undefined
    };
  }

  // A non-authorable source survives untouched, as long as the user has not switched the type away
  // from it. Note there is deliberately no `data.value` guard here: a `secret` source carries only
  // an opaque reference and never a literal, so gating on a literal is what destroyed it before.
  if (!isDesignerAuthorable(data.valueSourceType)) {
    const original = data.valueSourceOriginal;
    return original && original.type === data.valueSourceType ? original : undefined;
  }

  if (!data.value) return undefined;
  return { type: "static", value: data.value };
}

export function fromFlowStep(step: FlowStep): FlowDesignerNodeData {
  const catalogItem = getFlowNodeCatalogItem(step.type);
  const valueSource = step.valueSource;

  return {
    ...defaultNodeData(step.type, step.name, step.description ?? catalogItem.description),
    locatorStrategy: step.locator?.strategy ?? "role",
    locatorValue: step.locator?.value ?? "",
    locatorName: step.locator?.name ?? "",
    locatorExact: step.locator?.exact ?? false,
    locatorQuality: step.locator?.quality,
    // Preserve Recorder runtime fallbacks/scoping through the designer round-trip (edit-safe).
    locatorAlternatives: step.locator?.alternatives,
    locatorContext: step.locator?.context,
    valueSourceType: valueSource?.type ?? "static",
    // Preserved verbatim so a source the panel cannot author survives a save (see createValueSource).
    valueSourceOriginal: valueSource,
    // The LITERAL only. A typed source's own fields are no longer folded in here — that is what let
    // `step.url` overwrite an unrelated source field and corrupt it.
    value: step.value ?? (valueSource?.type === "static" ? valueSource.value : undefined) ?? step.url ?? "",
    dataSourceScope: valueSource?.dataSourceScope ?? "workflow",
    dataSourceId: valueSource?.dataSourceId ?? "",
    idMode: valueSource?.idMode ?? "instanceOrder",
    objectId: valueSource?.objectId ?? "",
    keyName: valueSource?.keyName ?? "",
    timeoutMs: step.timeoutMs ?? 10000,
    beforeWaits: step.beforeWaits ?? [],
    afterWaits: step.afterWaits ?? [],
    retryCount: step.retry?.count ?? 0,
    retryDelayMs: step.retry?.delayMs ?? 1000,
    failureAction: step.onFailure?.action ?? "stop",
    screenshotOnFailure: step.onFailure?.screenshot ?? true,
    outputKey: step.outputs ? Object.keys(step.outputs)[0] ?? "" : "",
    width: step.size?.width ?? DEFAULT_NODE_WIDTH,
    height: step.size?.height ?? DEFAULT_NODE_HEIGHT,
    clearBeforeFill: step.config?.clearBeforeFill ?? false,
    selectionMode: step.selectionMode ?? "value",
    selectMultiple: step.config?.selectMultiple ?? false,
    waitType: step.config?.waitType ?? (step.type === "wait" ? "time" : "selector"),
    assertionType: step.config?.assertionType ?? (step.type === "assertVisible" ? "visible" : "text"),
    comparisonOperator: step.config?.comparisonOperator ?? "equals",
    expectedValue: step.config?.expectedValue ?? "",
    screenshotName: step.config?.screenshotName ?? "",
    fullPage: step.config?.fullPage ?? false,
    scrollTarget: step.config?.scrollTarget ?? "page",
    scrollDirection: step.config?.scrollDirection ?? "down",
    scrollAmount: step.config?.scrollAmount ?? 500,
    loopType: step.config?.loopType ?? "fixedCount",
    iterationCount: step.config?.iterationCount ?? 3,
    loopActionType: step.config?.loopActionType ?? "click",
    loopStopOnFailure: step.config?.loopStopOnFailure ?? true,
    maxIterations: step.config?.maxIterations ?? 100,
    targetFlowId: step.flowId ?? step.config?.targetFlowId ?? "",
    stopParentOnChildFailure: step.config?.stopParentOnChildFailure ?? true,
    routeMode: step.config?.routeMode ?? "switchToLatestTab",
    urlMatch: step.config?.urlMatch ?? "contains",
    routeWaitUntil: step.config?.routeWaitUntil ?? "load",
    sessionName: step.config?.sessionName ?? "",
    sessionFolder: step.config?.sessionFolder ?? "",
    overwriteSession: step.config?.overwriteSession ?? false,
    captureScope: step.config?.captureScope ?? "context",
    maskSession: step.config?.maskSession ?? true,
    loginProvider: step.config?.loginProvider ?? "auto",
    handoffMode: step.config?.handoffMode ?? "pauseAndAsk",
    handoffInstructions: step.config?.handoffInstructions ?? "",
    allowRetry: step.config?.allowRetry ?? true,
    handoffTimeoutMs: step.config?.handoffTimeoutMs ?? 0,
    detectBeforeHandoff: step.config?.detectBeforeHandoff ?? true,
    reuseSessionMode: step.config?.reuseSessionMode ?? (step.config?.reuseSessionId ? "selected" : "autoDetect"),
    reuseSessionId: step.config?.reuseSessionId ?? "",
    oracle: step.type === "oracle" ? (step.config?.oracle ?? defaultOracleNodeConfig()) : undefined
  };
}

/**
 * Rebuild the designer's canvas document from a saved profile, exactly as `loadProfile` does
 * (`FlowChartDesigner.tsx`), minus the purely visual passes: `styledNode` and
 * `reconcileFlowBranches` are identity functions, and auto-layout only runs when node positions
 * are missing or stacked.
 */
export function toDesignerDocument(profile: FlowProfile): {
  nodes: FlowDesignerNode[];
  edges: FlowDesignerEdge[];
} {
  return {
    nodes: profile.nodes.map<FlowDesignerNode>((step) => ({
      id: step.id,
      type: "actionNode",
      position: step.position ?? { x: 280, y: 120 },
      data: fromFlowStep(step)
    })),
    edges: profile.edges.map<FlowDesignerEdge>((edge) =>
      createEdge(edge.source, edge.target, edge.type, edge.label, edge.condition?.expression, edge.style, edge.maxLoopCount, {
        kind: edge.kind,
        conditional: edge.conditional,
        parallel: edge.parallel,
        loop: edge.loop
      })
    )
  };
}
