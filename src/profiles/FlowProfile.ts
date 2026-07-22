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
  // ── Multi-Window / Popup ──────────────────────────────────────────────────
  /** Arm a popup/new-window listener before the opener click, then switch to the new page. */
  | "switchToPopup"
  /** Wait for the popup page to close; returns focus to the main page. */
  | "closePopup"
  /** Switch the active automation context back to the main page. */
  | "switchToMainPage"
  /** Run a read-only Oracle SQL query (Data Source or connection profile) and map the result. */
  | "oracle"
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
  /**
   * How uniqueness was achieved when no single strategy was globally unique:
   * `compound` = combined features/ancestors into one CSS selector; `container` = a readable
   * semantic locator scoped to a stable container; `positional` = a fragile index-based fallback.
   */
  disambiguation?: "compound" | "container" | "positional";
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
  | "instanceVariable"
  /** Named secret resolved at run time from the encrypted local secret store (never stored in JSON). */
  | "secret";

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
  /** Name of a stored secret (used when `type === "secret"`). */
  secretName?: string;
}

export type WaitHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Fields shared by every {@link WaitCondition}. */
export interface WaitConditionBase {
  /** Max time to wait before the condition fails (ms). Runner default: 30000. */
  timeoutMs?: number;
  /** Human-readable note (why the recorder captured this wait) — shown in diagnostics. */
  reason?: string;
  /**
   * When true, this condition is best-effort: if it is not satisfied it is logged but does NOT fail
   * the step (or, under `anyRequired`, does not count toward success). Absent/false = required
   * (the historical behavior). Enables optional loaders, optional background responses, etc.
   */
  optional?: boolean;
}

/** How a loader's disappearance/settling is detected in the loader lifecycle's completion phase. */
export type LoaderCompletion = "hidden" | "detached" | "ariaBusyFalse";

/**
 * Deterministic completion policy for a step's `afterWaits` (async awareness):
 * - `allRequired`  — every required wait must pass (default; the historical behavior).
 * - `anyRequired`  — succeed as soon as any required wait passes (multiple valid success signals).
 * - `networkThenUi`— required responses first, then loaders, then required UI outcomes, in phases,
 *                    with API↔UI consistency checks between them.
 * - `quietPeriod`  — complete once no new relevant request starts for a quiet window and no blocking
 *                    loader remains (ignores long-lived streams/WebSockets that start no new requests).
 */
export type AsyncCompletionMode = "allRequired" | "anyRequired" | "networkThenUi" | "quietPeriod";

/**
 * A condition-based wait (Smart Wait Engine). Executed by the runner before/after a step's
 * action via `FlowStep.beforeWaits` / `FlowStep.afterWaits`. Locator-based waits reuse the
 * structured {@link StepLocator} shape. The recorder can emit `afterWaits` from Smart Wait
 * observation while the legacy fixed-time `wait` step remains backward compatible.
 */
export type WaitCondition =
  | (WaitConditionBase & {
      type: "loaderHidden";
      locator: StepLocator;
      /**
       * Two-phase loader lifecycle (async awareness). When any of these are set the runner:
       *   1. arms observation before the action, then waits up to `appearanceGraceMs` for the loader
       *      to APPEAR (so a spinner that shows up late is never skipped);
       *   2. if it appeared, waits for the `completion` signal; if it never appeared, `mustAppear`
       *      decides between a clean pass (optional appearance) and a precise failure.
       * Absent = the legacy behavior (wait for the locator to be hidden).
       */
      appearanceGraceMs?: number;
      /** Require the loader to actually appear; if it never does within the grace, fail clearly. */
      mustAppear?: boolean;
      /** Which settle signal ends the completion phase. Default `hidden`. */
      completion?: LoaderCompletion;
    })
  | (WaitConditionBase & { type: "elementVisible"; locator: StepLocator })
  | (WaitConditionBase & { type: "elementHidden"; locator: StepLocator })
  | (WaitConditionBase & { type: "elementEnabled"; locator: StepLocator })
  | (WaitConditionBase & { type: "textVisible"; text: string; exact?: boolean })
  | (WaitConditionBase & { type: "toastVisible"; locator?: StepLocator; text?: string })
  | (WaitConditionBase & {
      type: "response";
      method?: WaitHttpMethod;
      urlContains?: string;
      statusRange?: [number, number];
      /** Register the response listener BEFORE the action so a fast response isn't missed. */
      armBeforeAction?: boolean;
    })
  | (WaitConditionBase & { type: "tableHasRows"; tableLocator: StepLocator; rowLocator?: StepLocator; minRows: number })
  | (WaitConditionBase & { type: "listHasItems"; listLocator: StepLocator; itemLocator?: StepLocator; minItems: number })
  | (WaitConditionBase & { type: "urlChanged"; fromUrl?: string; urlContains?: string })
  | (WaitConditionBase & { type: "domStable"; stableForMs?: number })
  | (WaitConditionBase & { type: "fixedDelay"; delayMs: number });

/**
 * Alias identifying which browser page/window a step acts on.
 * `'main'` is the primary recording page; `'popup-1'`, `'popup-2'`, … are opened windows.
 * When absent at runtime, defaults to `'main'`.
 */
export type PageAlias = "main" | `popup-${number}` | string;

/**
 * How the runner locates and validates a popup that a click step is expected to open.
 * All fields are optional to keep recorded flows forward-compatible.
 */
export interface PopupExpectation {
  /** Alias assigned to the popup page (e.g. `'popup-1'`). */
  popupAlias: PageAlias;
  /** Max ms to wait for the popup to appear after the opener action. Default: 15000. */
  timeoutMs?: number;
  /** URL substring the popup URL must contain (validation only — does not filter). */
  urlContains?: string;
  /** Page title substring the popup title must contain (validation only). */
  titleContains?: string;
  /** Playwright `waitForLoadState` target after the popup opens. Default: `'domcontentloaded'`. */
  waitUntil?: "domcontentloaded" | "load" | "networkidle";
  /**
   * What happens when the popup closes (e.g. user clicks Accept/window.close()).
   * - `'returnToMain'` (default): `activePage` reverts to `'main'` automatically.
   * - `'continueOnPopup'`: keep `activePage` on the popup until an explicit `switchToMainPage` step.
   */
  closeBehavior?: "returnToMain" | "continueOnPopup";
}

/** Side-effect classification for a step (Phase 3 explicit safety metadata). */
export type SideEffectLevel = "none" | "read" | "safeMutation" | "dangerousMutation" | "externalCommit" | "unknown";

/** Explicit per-step safety policy; authoritative for automatic-retry decisions when present. */
export interface StepSafetyPolicy {
  sideEffectLevel: SideEffectLevel;
  retryable: boolean;
  requiresIdempotencyKey?: boolean;
  idempotencyKeyExpression?: string;
  /** Extra resource keys this step needs exclusively (reserved for scheduler use). */
  exclusiveResources?: string[];
}

export interface FlowStep {
  id: string;
  type: StepType;
  name: string;
  description?: string;
  position?: { x: number; y: number };
  locator?: StepLocator;
  /** Condition-based waits run BEFORE this step's action (Smart Wait Engine, Phase 1). */
  beforeWaits?: WaitCondition[];
  /**
   * Condition-based waits run AFTER this step's action. A `response` wait with
   * `armBeforeAction: true` is registered before the action and awaited afterwards, so a
   * fast response triggered by the action is never missed.
   */
  afterWaits?: WaitCondition[];
  /**
   * How this step's `afterWaits` are combined into a single completion decision. Absent =
   * `allRequired` (the historical behavior: every required wait must pass). See {@link AsyncCompletionMode}.
   */
  completionMode?: AsyncCompletionMode;
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
  /**
   * Explicit side-effect safety metadata (Phase 3). Authoritative for retry decisions when
   * present; absent steps fall back to node-type defaults + the keyword heuristic. Optional and
   * backward compatible — existing saved flows load unchanged.
   */
  safety?: StepSafetyPolicy;
  next?: string;
  // ── Multi-Window / Popup ──────────────────────────────────────────────────
  /**
   * Which browser page/window this step targets. Defaults to `'main'` when absent.
   * Set automatically by the recorder for popup-context steps.
   */
  pageAlias?: PageAlias;
  /**
   * True when this step (typically a click) is expected to open a new browser window/tab.
   * The runner arms a `waitForEvent('popup')` immediately before the action so a fast popup
   * is not missed. The popup is registered under `popupExpectation.popupAlias`.
   */
  opensPopup?: boolean;
  /**
   * Describes the popup opened by this step. Required when `opensPopup` is true.
   * Also used by `switchToPopup` steps that explicitly arm popup capture.
   */
  popupExpectation?: PopupExpectation;
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
  // ── Multi-Window / Popup ──────────────────────────────────────────────────
  /** Alias of the popup page this closePopup/switchToMainPage step acts on. */
  popupAlias?: string;
  // ── Oracle node ────────────────────────────────────────────────────────────
  /** Oracle query node configuration (present only on `oracle` steps). */
  oracle?: OracleNodeConfig;
}

/** JDBC bind type used to convert a resolved value before binding (prepared statement). */
export type OracleJdbcBindType = "STRING" | "NUMBER" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "TIMESTAMP" | "NULL";

/** One prepared-statement bind for an Oracle node query. Values are ALWAYS bound, never interpolated. */
export interface OracleNodeBind {
  /** 1-based ordinal for positional binds, or a `name` for named (`:name`) binds. */
  position?: number;
  name?: string;
  jdbcType: OracleJdbcBindType;
  /** Where the value comes from — reuses AWKIT's existing dynamic value resolution. */
  valueSource: ValueSource;
  required?: boolean;
  /** Fallback when a non-required dynamic source resolves to empty. */
  defaultValue?: string;
}

/** Configuration for the Oracle query node (`FlowStep.config.oracle`). */
export interface OracleNodeConfig {
  /** Use an existing Oracle Data Source, or a connection profile directly. */
  connectionSource: "dataSource" | "profile";
  /** Selected Oracle Data Source id (when `connectionSource === "dataSource"`). */
  dataSourceId?: string;
  /** Selected Oracle connection profile id (when `connectionSource === "profile"`). */
  connectionProfileId?: string;
  /** SQL: required for `profile`; an optional override of the Data Source's own query for `dataSource`. */
  sql?: string;
  binds?: OracleNodeBind[];
  timeoutMs?: number;
  maxRows?: number;
  fetchSize?: number;
  /** Deterministic mapping of the result to a typed value. */
  returnType: "string" | "number" | "boolean" | "list";
  /** Column to read for scalar/primitive-list mappings (defaults to the first column). */
  selectedColumn?: string;
  /** Row index to read for scalar mappings (defaults to 0). */
  selectedRowIndex?: number;
  /** What to return when the result is empty. */
  emptyBehavior?: "null" | "error" | "default";
  defaultValue?: string;
  /** Scalar mappings with multiple rows: take the first, or fail. */
  multiRowBehavior?: "first" | "error";
  /** List: array of row objects, or a primitive array of the selected column. */
  listMode?: "rows" | "column";
  /** Comma-separated values mapped to boolean true / false (case-insensitive). */
  booleanTrueValues?: string;
  booleanFalseValues?: string;
  /** Instance variable to store the mapped value into (in addition to step outputs). */
  outputVariable?: string;
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
