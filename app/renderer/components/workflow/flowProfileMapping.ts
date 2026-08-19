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
import { connectorKind } from "@src/profiles/FlowProfile";
import { invalidateStaleLocatorApproval } from "@src/profiles/locatorApproval";
import { invalidateStaleInteractionDecision, isPrerequisiteOnlyLocatorReview } from "@src/profiles/interactionPrerequisiteDecision";
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
import { hasSection, type PropertySection } from "./flowNodeRegistry";

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
  extra?: Partial<FlowConnectionData>,
  id?: string
): FlowDesignerEdge {
  return {
    // RT-05: preserve the persisted edge id on load; synthesize one only for user-created connectors.
    // The synthetic `edge-<source>-<target>` form collides when two edges share a source and target
    // (legal conditional/parallel fan-out), which is exactly why the persisted id must be threaded.
    id: id ?? `edge-${source}-${target}`,
    source,
    target,
    ...buildConnectorVisual(linkType, style),
    // RT-08: `data.label` is the *authored* label (undefined when none) and is what `toFlowProfile`
    // persists; the render label below falls back to the connector type for display only, so an
    // unlabelled connector is not saved as though the user had typed its type as a label.
    data: { linkType, label, expression: expression ?? "", style, maxLoopCount, ...extra },
    label: label ?? linkType
  };
}

/**
 * Flow-level metadata the designer must carry through a load→save cycle. The canvas document only
 * holds nodes + edges, so `description`/`version`/timestamps have to be threaded separately from the
 * loaded profile; without them `toFlowProfile` used to hardcode a description and `version: 1` and
 * drop the timestamps (RT-06/RT-07). A brand-new designer flow passes no meta and keeps the defaults.
 */
export interface FlowProfileMeta {
  description?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function toFlowProfile(
  nodes: FlowDesignerNode[],
  edges: FlowDesignerEdge[],
  id: string,
  name: string,
  meta?: FlowProfileMeta
): FlowProfile {
  return {
    id,
    name,
    // RT-06: preserve the loaded description/version instead of hardcoding literals. `meta.description`
    // is used verbatim (even when undefined) so a description-less flow round-trips unchanged.
    description: meta ? meta.description : "Editable reusable flow",
    version: meta?.version ?? 1,
    nodes: nodes.map((node) => toFlowStep(node, edges)),
    edges: edges.map((edge) => {
      const type = edge.data?.linkType ?? "success";
      // Legacy profiles can omit `kind`; the editor correctly derives it from `type`, so the save
      // boundary must use the same canonical derivation or a reopened Loop silently loses its
      // configuration. Keep the authored optional `kind` unchanged: normalising a legacy
      // `loopBack` to `kind: "loop"` would change its validation semantics.
      const derivedKind = connectorKind({ type, kind: edge.data?.kind });
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type,
        kind: edge.data?.kind,
        conditional: derivedKind === "conditional" ? edge.data?.conditional : undefined,
        parallel: derivedKind === "parallel" ? edge.data?.parallel : undefined,
        // Preserve an attached opaque Loop payload on legacy `loopBack` edges as authored data.
        // Runtime still keys on `type`, so this does not merge the two execution models.
        loop: derivedKind === "loop" ? edge.data?.loop : undefined,
        label: edge.data?.label,
        condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
        style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined,
        // RT-11: persist maxLoopCount whenever it is set, on any connector; let the runtime apply its
        // own default when it is absent instead of fabricating a 2 on save.
        maxLoopCount: edge.data?.maxLoopCount
      };
    }),
    // RT-07: preserve createdAt; updatedAt is carried here and bumped at actual save time by the store.
    createdAt: meta?.createdAt,
    updatedAt: meta?.updatedAt
  };
}

/** Optional `FlowStep` fields the designer defaults on load; tracked so a no-op save re-omits them. */
export const OPTIONAL_STEP_FIELDS = ["description", "timeoutMs", "retry", "onFailure", "size", "next"] as const;

export function toFlowStep(node: FlowDesignerNode, edges: FlowDesignerEdge[]): FlowStep {
  const data = node.data;
  const catalogItem = getFlowNodeCatalogItem(data.stepType);
  const next = edges.find((edge) => edge.source === node.id)?.target;
  const valueSource = createValueSource(data);
  // RT-10: a field that was absent on the loaded profile is omitted again rather than written back as
  // the default the runner would have applied anyway, so a no-op open+save stays byte-stable. Nodes
  // created in the designer carry no `absentOnLoad` and emit their defaults exactly as before.
  const wasAbsent = (field: (typeof OPTIONAL_STEP_FIELDS)[number]): boolean => data.absentOnLoad?.includes(field) ?? false;
  // ...but never drop a value the user actually changed: only re-omit when the field is still exactly
  // the default `fromFlowStep` applied on load (`atDefault`), so an edit to a previously-absent field
  // is always persisted.
  const omit = (field: (typeof OPTIONAL_STEP_FIELDS)[number], atDefault: boolean): boolean => wasAbsent(field) && atDefault;

  const step: FlowStep = {
    id: node.id,
    type: data.stepType,
    name: data.name,
    description: omit("description", data.description === catalogItem.description) ? undefined : data.description,
    position: node.position,
    // `next` mirrors the outgoing edge (routing lives in `edges`), so it is re-omitted whenever it was
    // absent on load rather than compared to a default — the edge still carries the route either way.
    next: wasAbsent("next") ? undefined : next,
    // RT-01: persist a locator whenever the step actually carries one. `requiresLocator` is a
    // *validation* rule ("the user must supply one"), not a *persistence* rule — conflating them
    // silently dropped Recorder-captured locators on `wait`/`screenshot`, which the runner still uses.
    locator: data.locatorValue
      ? {
        strategy: data.locatorStrategy,
        value: data.locatorValue,
        name: data.locatorName || undefined,
        exact: data.locatorExact || undefined,
        quality: data.locatorQuality,
        // Keep the Recorder's runtime fallbacks + container/frame scoping on save.
        alternatives: data.locatorAlternatives,
        context: data.locatorContext,
        interaction: data.locatorInteraction,
        identity: data.locatorIdentity,
        prerequisite: data.locatorPrerequisite,
        executionDecision: data.locatorExecutionDecision,
        resolution: data.locatorResolution,
        resolvedBy: data.locatorResolvedBy,
        approvedFallbackReason: data.locatorApprovedFallbackReason,
        approvedFallbackBinding: data.locatorApprovedFallbackBinding,
        reviewReason: data.locatorReviewReason,
        guard: data.locatorGuard,
        blueprintId: data.locatorBlueprintId
      }
      : undefined,
    // Drag drop-target: re-emitted for `drag` steps, carried verbatim (like `locatorGuard`) so a
    // designer edit/save never drops it. Absent on non-drag steps.
    targetLocator: data.stepType === "drag" ? data.targetLocator : undefined,
    value: data.value || undefined,
    valueSource,
    // `|| undefined` so a goto with no literal (its value comes from a source) does not persist `url: ""`.
    url: data.stepType === "goto" ? data.value || undefined : undefined,
    timeoutMs: omit("timeoutMs", data.timeoutMs === 10000) ? undefined : data.timeoutMs,
    beforeWaits: data.beforeWaits?.length ? data.beforeWaits : undefined,
    afterWaits: data.afterWaits?.length ? data.afterWaits : undefined,
    retry: omit("retry", data.retryCount === 0 && data.retryDelayMs === 1000) ? undefined : { count: data.retryCount, delayMs: data.retryDelayMs },
    onFailure: omit("onFailure", data.failureAction === "stop" && data.screenshotOnFailure) ? undefined : { action: data.failureAction, screenshot: data.screenshotOnFailure },
    // RT-12: preserve the full outputs map; the panel edits a single key but a step may declare
    // several typed outputs, and rebuilding `{ [key]: { type: "text" } }` dropped all but the first.
    outputs: data.outputsOriginal ?? (data.outputKey ? { [data.outputKey]: { type: "text" } } : undefined),
    selectionMode: data.stepType === "select" ? data.selectionMode : undefined,
    flowId: data.stepType === "runFlow" ? data.targetFlowId || undefined : undefined,
    size: omit("size", Math.round(data.width) === DEFAULT_NODE_WIDTH && Math.round(data.height) === DEFAULT_NODE_HEIGHT)
      ? undefined
      : { width: Math.round(data.width), height: Math.round(data.height) },
    config: toNodeConfig(data),
    // Recorder-owned fields the designer cannot author: preserved verbatim so a recorded flow is not
    // degraded by a designer re-save. RT-03 (popup metadata), RT-04 (safety), RT-15 (loop/message).
    safety: data.safety,
    pageAlias: data.pageAlias,
    opensPopup: data.opensPopup,
    popupExpectation: data.popupExpectation,
    dialogExpectation: data.dialogExpectation,
    waitUntil: data.waitUntil,
    loop: data.loop,
    message: data.message
  };
  return invalidateStaleInteractionDecision(invalidateStaleLocatorApproval(step));
}

/**
 * Build the `NodeConfig` for a step, emitting **only the fields the node type actually uses** and
 * omitting the object entirely when the type has none (RT-09).
 *
 * `toNodeConfig` used to emit ~16 always-populated fields on every node, so a `goto` carried loop
 * and scroll settings and a config-less `click` acquired a full defaulted object — which inflated
 * saved JSON and made a no-op open+save non-idempotent. Field ownership is derived from the node
 * registry's property `sections` (the same source the Node Properties panel gates on), so this
 * cannot drift as node types are added. The already type-scoped groups (routeChange/session/…) keep
 * their exact-type guards, which are equivalent since each of those sections belongs to one type.
 */
export function toNodeConfig(data: FlowDesignerNodeData): NodeConfig | undefined {
  const type = data.stepType;
  const inSection = (section: PropertySection): boolean => hasSection(type, section);
  const config: NodeConfig = {
    clearBeforeFill: type === "fill" ? data.clearBeforeFill : undefined,
    selectMultiple: inSection("select") ? data.selectMultiple : undefined,
    waitType: inSection("wait") ? data.waitType : undefined,
    assertionType: inSection("assertion") ? data.assertionType : undefined,
    // A "visible" assertion has no comparison operator; only value-comparing assertions do.
    comparisonOperator: inSection("assertion") && data.assertionType !== "visible" ? data.comparisonOperator : undefined,
    expectedValue: inSection("assertion") ? data.expectedValue || undefined : undefined,
    // Only an `attribute` assertion carries an attribute name; other types must not persist one.
    attributeName: inSection("assertion") && data.assertionType === "attribute" ? data.attributeName || undefined : undefined,
    holdMs: inSection("hold") ? data.holdMs : undefined,
    storageArea: inSection("assertion") && data.assertionType === "storage" ? data.storageArea : undefined,
    storageKey: inSection("assertion") && data.assertionType === "storage" ? data.storageKey || undefined : undefined,
    screenshotName: inSection("screenshot") ? data.screenshotName || undefined : undefined,
    fullPage: inSection("screenshot") ? data.fullPage : undefined,
    scrollTarget: inSection("scroll") ? data.scrollTarget : undefined,
    scrollDirection: inSection("scroll") ? data.scrollDirection : undefined,
    scrollAmount: inSection("scroll") ? data.scrollAmount : undefined,
    loopType: inSection("loop") ? data.loopType : undefined,
    iterationCount: inSection("loop") ? data.iterationCount : undefined,
    loopActionType: inSection("loop") ? data.loopActionType : undefined,
    loopStopOnFailure: inSection("loop") ? data.loopStopOnFailure : undefined,
    maxIterations: inSection("loop") ? data.maxIterations : undefined,
    targetFlowId: inSection("runFlow") ? data.targetFlowId || undefined : undefined,
    stopParentOnChildFailure: inSection("runFlow") ? data.stopParentOnChildFailure : undefined,
    routeMode: type === "routeChange" ? data.routeMode : undefined,
    urlMatch: type === "routeChange" ? data.urlMatch : undefined,
    routeWaitUntil: type === "routeChange" ? data.routeWaitUntil : undefined,
    sessionName: type === "saveSession" ? data.sessionName || undefined : undefined,
    sessionFolder: type === "saveSession" ? data.sessionFolder || undefined : undefined,
    overwriteSession: type === "saveSession" ? data.overwriteSession : undefined,
    captureScope: type === "saveSession" ? data.captureScope : undefined,
    maskSession: type === "saveSession" ? data.maskSession : undefined,
    loginProvider: type === "protectedLoginHandoff" ? data.loginProvider : undefined,
    handoffMode: type === "protectedLoginHandoff" ? data.handoffMode : undefined,
    handoffInstructions: type === "protectedLoginHandoff" ? data.handoffInstructions || undefined : undefined,
    allowRetry: type === "protectedLoginHandoff" ? data.allowRetry : undefined,
    handoffTimeoutMs: type === "protectedLoginHandoff" ? data.handoffTimeoutMs : undefined,
    detectBeforeHandoff: type === "protectedLoginHandoff" ? data.detectBeforeHandoff : undefined,
    reuseSessionMode: type === "reuseSession" ? data.reuseSessionMode : undefined,
    reuseSessionId: type === "reuseSession" && data.reuseSessionMode === "selected" ? data.reuseSessionId || undefined : undefined,
    oracle: type === "oracle" ? data.oracle : undefined
  };
  const defined = Object.entries(config).filter(([, value]) => value !== undefined);
  return defined.length ? (Object.fromEntries(defined) as NodeConfig) : undefined;
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
      // RT-13: retain the id/objectId even when the sibling discriminator does not currently select
      // it. The resolver keys off `dataSourceScope`/`idMode`, so a carried value is inert at run time
      // but survives a user narrowing the binding back to workflow scope and switching it out again.
      dataSourceId: data.dataSourceId || undefined,
      idMode: data.idMode,
      objectId: data.objectId || undefined,
      keyName: data.keyName || undefined
    };
  }

  // `"none"` is the designer-only sentinel for "a bare `value` with no explicit source" (e.g. a
  // condition expression). It must round-trip as `value` alone and never fabricate a `static`
  // source, so it returns before any of the source-building paths below (bead awkit-cxa).
  if (data.valueSourceType === "none") return undefined;

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
    locatorInteraction: step.locator?.interaction,
    locatorIdentity: step.locator?.identity,
    locatorPrerequisite: step.locator?.prerequisite,
    locatorExecutionDecision: step.locator?.executionDecision,
    locatorResolution: isPrerequisiteOnlyLocatorReview(step.locator) ? "resolved" : step.locator?.resolution,
    locatorResolvedBy: step.locator?.resolvedBy,
    locatorApprovedFallbackReason: step.locator?.approvedFallbackReason,
    locatorApprovedFallbackBinding: step.locator?.approvedFallbackBinding,
    locatorReviewReason: step.locator?.reviewReason,
    locatorGuard: step.locator?.guard,
    locatorBlueprintId: step.locator?.blueprintId,
    // Drag drop-target: carried verbatim so a designer edit/save never drops it (preserve, don't re-derive).
    targetLocator: step.targetLocator,
    valueSourceType: valueSource?.type ?? "static",
    // Preserved verbatim so a source the panel cannot author survives a save (see createValueSource).
    valueSourceOriginal: valueSource,
    // Recorder-owned fields the designer cannot author, kept for a lossless round-trip.
    safety: step.safety,
    pageAlias: step.pageAlias,
    opensPopup: step.opensPopup,
    popupExpectation: step.popupExpectation,
    dialogExpectation: step.dialogExpectation,
    waitUntil: step.waitUntil,
    outputsOriginal: step.outputs,
    loop: step.loop,
    message: step.message,
    // RT-10: record which optional fields were absent so `toFlowStep` can omit them again.
    absentOnLoad: OPTIONAL_STEP_FIELDS.filter((field) => step[field] === undefined),
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
    attributeName: step.config?.attributeName ?? "",
    holdMs: step.config?.holdMs ?? 1000,
    storageArea: step.config?.storageArea ?? "local",
    storageKey: step.config?.storageKey ?? "",
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
      createEdge(
        edge.source,
        edge.target,
        edge.type,
        edge.label,
        edge.condition?.expression,
        edge.style,
        edge.maxLoopCount,
        {
          kind: edge.kind,
          conditional: edge.conditional,
          parallel: edge.parallel,
          loop: edge.loop
        },
        edge.id
      )
    )
  };
}
