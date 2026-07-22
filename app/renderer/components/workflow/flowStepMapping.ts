import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, defaultNodeData, defaultOracleNodeConfig, type FlowDesignerNodeData } from "./flowDesignerTypes";
import { getFlowNodeCatalogItem } from "./flowNodeCatalog";
import type { CanvasEdge, CanvasNode } from "../canvas";
import type { FlowConnectionData } from "./ConnectionPropertiesPanel";
import type { FlowStep, NodeConfig, ValueSource } from "@src/profiles/FlowProfile";

/**
 * The Flow Designer's model <-> canvas-node conversion pair.
 *
 * Extracted verbatim from `pages/FlowChartDesigner.tsx` so the SAME functions the designer runs can
 * be executed by a round-trip verifier (`scripts/verify-flow-step-mapping.mts`). This module is the
 * only place a saved `FlowStep` becomes designer node data and back again, which makes it the single
 * point where a silently dropped field would corrupt a saved flow — hence the executable coverage.
 *
 * Behavior is intentionally unchanged: no schema changes, no renames, no new defaults, no
 * recalculation. Every import here is either a plain non-React module or `import type` (erased at
 * compile time), so the module carries no React runtime and can be loaded by a `tsx` verifier.
 */

export type FlowDesignerNode = CanvasNode<FlowDesignerNodeData>;
export type FlowDesignerEdge = CanvasEdge<FlowConnectionData>;

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
    url: data.stepType === "goto" ? data.value : undefined,
    timeoutMs: data.timeoutMs,
    beforeWaits: data.beforeWaits?.length ? data.beforeWaits : undefined,
    afterWaits: data.afterWaits?.length ? data.afterWaits : undefined,
    completionMode: data.completionMode,
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

  // A bare value with no explicit source (awkit-cxa): re-serialize `value` alone. `toFlowStep` still
  // emits `value: data.value`, so the value survives without a fabricated static `valueSource`.
  if (data.valueSourceType === "none") return undefined;

  if (!data.value) return undefined;

  if (data.valueSourceType === "env") return { type: "env", envKey: data.value };
  if (data.valueSourceType === "runtimeInput") return { type: "runtimeInput", key: data.value };
  if (data.valueSourceType === "json") return { type: "json", path: data.value };
  if (data.valueSourceType === "flowOutput") return { type: "flowOutput", outputKey: data.value };
  if (data.valueSourceType === "generated") return { type: "generated", generator: data.value as ValueSource["generator"] };
  if (data.valueSourceType === "currentRow") return { type: "currentRow", path: data.value };
  if (data.valueSourceType === "instanceVariable") return { type: "instanceVariable", key: data.value };
  // Named secret: only the NAME round-trips (the secret value is never stored in JSON). Without this
  // branch the type would silently degrade to "static", leaking the name as a literal value.
  if (data.valueSourceType === "secret") return { type: "secret", secretName: data.value };

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
    // A step can carry a bare `value` (e.g. a condition expression) with no `valueSource`. Mark it
    // "none" so the save path re-serializes the value WITHOUT fabricating a static `valueSource`, and
    // read `step.value` last in the value chain so a bare value is never dropped on load (awkit-cxa).
    valueSourceType: valueSource?.type ?? (!step.url && !!step.value ? "none" : "static"),
    value: step.url ?? valueSource?.value ?? valueSource?.key ?? valueSource?.envKey ?? valueSource?.path ?? valueSource?.outputKey ?? valueSource?.generator ?? valueSource?.secretName ?? step.value ?? "",
    dataSourceScope: valueSource?.dataSourceScope ?? "workflow",
    dataSourceId: valueSource?.dataSourceId ?? "",
    idMode: valueSource?.idMode ?? "instanceOrder",
    objectId: valueSource?.objectId ?? "",
    keyName: valueSource?.keyName ?? "",
    timeoutMs: step.timeoutMs ?? 10000,
    beforeWaits: step.beforeWaits ?? [],
    afterWaits: step.afterWaits ?? [],
    completionMode: step.completionMode,
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
