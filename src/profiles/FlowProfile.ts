export type StepType =
  | "start"
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "radio"
  | "scroll"
  | "wait"
  | "uploadFile"
  | "downloadFile"
  | "readText"
  | "assertText"
  | "assertVisible"
  | "screenshot"
  | "manualHandoff"
  | "condition"
  | "loop"
  | "runFlow"
  | "routeChange"
  | "saveSession"
  | "protectedLoginHandoff"
  | "autoSecureLogin"
  | "reuseSession"
  | "end";

export type LocatorStrategy = "role" | "label" | "placeholder" | "text" | "testId" | "id" | "css" | "xpath" | "tagName";

/**
 * Uniqueness / stability metadata for a locator, captured by the Recorder when a
 * step is generated (or left undefined for older/hand-authored steps). Used to keep
 * the Flow Designer from reporting a non-unique locator as fully valid and to let the
 * runner fail early with a friendly message instead of a raw strict-mode violation.
 */
export interface LocatorQuality {
  /** Strategy that produced the saved locator; "fallback" marks a positional last-resort. */
  strategy: LocatorStrategy | "fallback";
  /** Whether the locator resolved to exactly one element when it was generated. */
  isUnique: boolean;
  /** Number of elements the locator matched at generation time. */
  matchCount: number;
  confidence: "high" | "medium" | "low";
  /** Human-readable reason the locator is fragile/non-unique (shown in the UI). */
  warning?: string;
  /** How many candidate locators were generated before this one was chosen. */
  candidateCount?: number;
}

/**
 * A single Playwright-buildable locator. The primary locator on a step and every runtime
 * fallback ({@link StepLocator.alternatives}) share this shape.
 */
export interface LocatorCandidate {
  strategy: LocatorStrategy;
  value: string;
  /** Accessible name for the `role` strategy. */
  name?: string;
  /** For role/text/label/placeholder: match exactly (Playwright `exact`). */
  exact?: boolean;
}

/**
 * A stable container the primary + alternatives are resolved *inside*, so a repeated control
 * (row button, card action, duplicate modal) targets the right subtree. Resolved to a single
 * element at run time — `visibleOnly`/`hasText` disambiguate hidden templates and repeats.
 */
export interface LocatorContainerContext extends LocatorCandidate {
  type: "dialog" | "tableRow" | "card" | "listItem";
  /** Narrow repeated containers (rows/cards) to the one whose text matches. */
  hasText?: string;
  /** Prefer the single *visible* container (hidden modal template + visible modal). */
  visibleOnly?: boolean;
}

/** The target lives inside an iframe; resolved via `page.frameLocator(selector)`. */
export interface LocatorFrameContext {
  /** CSS selector for the `<iframe>` element in the top document. */
  selector: string;
}

export interface LocatorContext {
  frame?: LocatorFrameContext;
  container?: LocatorContainerContext;
}

/**
 * A recorded locator: the primary candidate plus optional runtime fallbacks, container/frame
 * scoping, and record-time quality metadata. Legacy steps only set the primary fields — the
 * new `alternatives`/`context` fields are optional, so old saved flows deserialize unchanged.
 */
export interface StepLocator extends LocatorCandidate {
  /** Uniqueness/quality metadata captured at record time (optional for legacy steps). */
  quality?: LocatorQuality;
  /** Ranked fallbacks the runner tries when the primary is missing or ambiguous. */
  alternatives?: LocatorCandidate[];
  /** Container/frame scoping applied to the primary and every alternative. */
  context?: LocatorContext;
}

export type ValueSourceType =
  | "static"
  | "dynamic"
  | "json"
  | "runtimeInput"
  | "env"
  | "flowOutput"
  | "generated"
  | "currentRow"
  | "instanceVariable";

/** How a dynamic value resolves the object id within its data source. */
export type DynamicIdMode = "explicit" | "instanceOrder";

/** Whether a dynamic value reads the workflow data source or a specific one. */
export type DataSourceScope = "workflow" | "specific";

export interface ValueSource {
  type: ValueSourceType;
  value?: string;
  // Dynamic (JSON data source) binding:
  dataSourceScope?: DataSourceScope;
  dataSourceId?: string;
  idMode?: DynamicIdMode;
  objectId?: string;
  keyName?: string;
  // Legacy / advanced sources still supported by the resolver:
  file?: string;
  path?: string;
  key?: string;
  envKey?: string;
  flowId?: string;
  outputKey?: string;
  generator?: "uuid" | "timestamp" | "randomEmail" | "randomNumber";
}

export interface FlowStep {
  id: string;
  type: StepType;
  name: string;
  description?: string;
  position?: { x: number; y: number };
  locator?: StepLocator;
  value?: string;
  valueSource?: ValueSource;
  selectionMode?: "value" | "label" | "index";
  url?: string;
  timeoutMs?: number;
  retry?: {
    count: number;
    delayMs: number;
  };
  onFailure?: {
    action: "stop" | "continue" | "goToFailureEdge" | "manualHandoff";
    screenshot: boolean;
  };
  outputs?: Record<string, unknown>;
  message?: string;
  flowId?: string;
  loop?: {
    valueSource?: ValueSource;
    maxIterations?: number;
  };
  /** Canvas node size (px) for the Flow Designer. */
  size?: { width: number; height: number };
  /** Type-specific designer configuration (wait/assertion/screenshot/scroll/loop/runFlow). */
  config?: NodeConfig;
  next?: string;
}

export interface NodeConfig {
  clearBeforeFill?: boolean;
  selectMultiple?: boolean;
  waitType?: "time" | "selector" | "navigation" | "networkIdle" | "textVisible";
  assertionType?: "visible" | "text" | "value" | "count" | "url";
  comparisonOperator?: "equals" | "contains" | "greaterThan" | "lessThan";
  expectedValue?: string;
  screenshotName?: string;
  fullPage?: boolean;
  scrollTarget?: "page" | "element";
  scrollDirection?: "up" | "down" | "left" | "right";
  scrollAmount?: number;
  loopType?: "fixedCount" | "elements" | "dataRows";
  iterationCount?: number;
  loopActionType?: "click" | "fill" | "scroll" | "delete" | "customFlow";
  loopStopOnFailure?: boolean;
  maxIterations?: number;
  targetFlowId?: string;
  stopParentOnChildFailure?: boolean;
  // ── Route Change (switch active page/tab/URL) ──────────────────────────────
  routeMode?: "switchToUrl" | "switchToLatestTab" | "waitForNewTab" | "navigateCurrentPage";
  urlMatch?: "exact" | "contains" | "regex";
  routeWaitUntil?: "domcontentloaded" | "load" | "networkidle";
  // ── Save Session (persist Playwright storage state) ────────────────────────
  sessionName?: string;
  sessionFolder?: string;
  overwriteSession?: boolean;
  captureScope?: "context" | "origin";
  maskSession?: boolean;
  // ── Protected Login Handoff ────────────────────────────────────────────────
  loginProvider?: "auto" | "google" | "microsoft" | "okta" | "auth0" | "duo" | "other";
  handoffMode?: "pauseAndAsk" | "openSystemBrowserOAuth" | "useSavedSession" | "useTestSession" | "cancel";
  handoffInstructions?: string;
  allowRetry?: boolean;
  handoffTimeoutMs?: number;
  detectBeforeHandoff?: boolean;
  // ── Reuse Session (load a previously captured session profile) ─────────────
  /** How the session is resolved: auto-detect by target origin, or an explicitly selected session. */
  reuseSessionMode?: "autoDetect" | "selected";
  reuseSessionId?: string;
}

export type FlowEdgeType =
  | "success"
  | "failure"
  | "always"
  | "conditional"
  | "outcome"
  | "manualApproval"
  | "loop"
  | "loopBack"
  | "parallel";

/** Optional per-connector visual customization (Flow Designer + Workflow Builder). */
export interface EdgeVisualStyle {
  /** Preset color key OR a hex string; empty/undefined → default by connector type. */
  color?: string;
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Stroke width in px (1–5). */
  thickness?: number;
  shape?: "smoothstep" | "bezier" | "straight" | "step" | "circular";
  arrowHead?: "default" | "closed" | "none";
}

/**
 * Structured connector (edge) model. Every connector belongs to one of four kinds.
 * Legacy edges (no `kind`) are treated as `normal`, except that the older
 * `conditional`/`outcome`/`loop`/`loopBack` edge `type`s still drive their existing
 * expression-based routing for backward compatibility.
 */
export type ConnectorKind = "normal" | "conditional" | "parallel" | "loop";

export type ConnectorConditionOperator =
  | "always"
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "exists"
  | "notExists"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "truthy"
  | "falsy";

/** Where a conditional connector reads the value it compares. */
export type ConnectorConditionSource = "outcome" | "status" | "errorCode" | "variable" | "dataSourceValue";

export interface ConditionalConnectorConfig {
  sourceField: ConnectorConditionSource;
  /** Path/key when sourceField is `variable` or `dataSourceValue` (e.g. `outputs.flow.status`). */
  variableName?: string;
  operator: ConnectorConditionOperator;
  expectedValue?: string | number | boolean;
  /** Higher priority wins when multiple conditional connectors match (default 0). */
  priority?: number;
  label?: string;
}

export interface ParallelConnectorConfig {
  joinMode: "waitAll" | "waitAny";
  failMode: "failFast" | "collectErrors";
  /**
   * `sharedPage` (default) runs branches as sequential fan-out on the current page (safe, no
   * concurrent UI mutation). `isolatedPage` runs branches concurrently, each on its own page in
   * the shared browser context (shared cookies/session, independent DOM/navigation), bounded by
   * `maxConcurrency`.
   */
  isolation?: "sharedPage" | "isolatedPage";
  /** Max branches running at once in `isolatedPage` mode (default: number of branches). */
  maxConcurrency?: number;
  label?: string;
}

export interface LoopConnectorConfig {
  mode: "count" | "staticList" | "dataSource" | "whileCondition";
  maxIterations: number;
  staticValues?: unknown[];
  dataSourceId?: string;
  dataSourceBinding?: string;
  /** Runtime-input key the loop value is injected under so the target node can read it. */
  parameterName?: string;
  condition?: ConditionalConnectorConfig;
  delayMs?: number;
  label?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: FlowEdgeType;
  /** Structured connector category. When omitted, derived from `type` (see connectorKind). */
  kind?: ConnectorKind;
  /** Structured config for a conditional connector. */
  conditional?: ConditionalConnectorConfig;
  /** Structured config for a parallel connector. */
  parallel?: ParallelConnectorConfig;
  /** Structured config for a loop connector. */
  loop?: LoopConnectorConfig;
  label?: string;
  condition?: { expression: string };
  style?: EdgeVisualStyle;
  /** For loopBack edges: maximum number of times this back-edge can be traversed before stopping. */
  maxLoopCount?: number;
}

/** Derive the structured connector kind for an edge, defaulting from its legacy `type`. */
export function connectorKind(edge: Pick<FlowEdge, "kind" | "type">): ConnectorKind {
  if (edge.kind) return edge.kind;
  switch (edge.type) {
    case "conditional":
    case "outcome":
      return "conditional";
    case "parallel":
      return "parallel";
    case "loop":
    case "loopBack":
      return "loop";
    default:
      return "normal";
  }
}

/**
 * Structural connector safeguards (Points 2–4), shared by the Flow Designer UI and the
 * runner so an invalid flow can't execute even if it somehow bypasses the UI validation:
 *  - a node may have at most one standard (non-conditional/non-parallel) outgoing edge;
 *  - a loop connector's source and target must be the same node;
 *  - a node with a self-loop connector may only route additional outgoing edges as Conditional.
 */
export function validateConnectorStructure(edges: FlowEdge[]): string[] {
  const messages: string[] = [];

  // Only the new structured `loop` kind is self-only; the legacy `loopBack` edge type
  // (Enhanced Connectors, Phase 1) is an intentional cross-node back-edge and is exempt.
  edges.forEach((edge) => {
    const isStructuredLoop = edge.kind === "loop" || edge.type === "loop";
    if (isStructuredLoop && edge.source !== edge.target) {
      messages.push(`Loop connector ${edge.id} is invalid because it does not return to the same node.`);
    }
  });

  const outgoingBySource = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    const list = outgoingBySource.get(edge.source) ?? [];
    list.push(edge);
    outgoingBySource.set(edge.source, list);
  });
  outgoingBySource.forEach((sourceEdges, source) => {
    const standard = sourceEdges.filter((edge) => connectorKind(edge) !== "conditional" && connectorKind(edge) !== "parallel");
    if (standard.length > 1) {
      messages.push(`Node ${source} has multiple standard outgoing connectors — routing would be ambiguous.`);
    }
  });

  const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && connectorKind(edge) === "loop").map((edge) => edge.source));
  edges.forEach((edge) => {
    if (!loopSources.has(edge.source) || edge.source === edge.target) return;
    if (connectorKind(edge) !== "conditional") {
      messages.push(`Node ${edge.source} has a loop connector; additional outgoing connectors must be Conditional.`);
    }
  });

  return messages;
}

export interface FlowProfile {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodes: FlowStep[];
  edges: FlowEdge[];
  createdAt?: string;
  updatedAt?: string;
}
