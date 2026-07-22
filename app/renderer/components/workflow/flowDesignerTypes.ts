import type { DataSourceScope, DynamicIdMode, FlowStep, LocatorCandidate, LocatorContext, LocatorQuality, LocatorStrategy, OracleNodeConfig, StepType, ValueSourceType, WaitCondition } from "@src/profiles/FlowProfile";
import type { ConnectorPortFlags } from "../shared/connectorStyle";

export type ValidationState = "valid" | "warning" | "error";

/** Simplified value source kinds shown in Node Properties. */
export type SimpleValueSourceKind = "static" | "dynamic";

export interface FlowDesignerNodeData extends Record<string, unknown> {
  stepType: StepType;
  name: string;
  description: string;
  locatorStrategy: LocatorStrategy;
  locatorValue: string;
  locatorName: string;
  /** Match the accessible name/text exactly (role/text strategies). */
  locatorExact: boolean;
  /** Uniqueness/quality metadata captured by the Recorder (undefined for hand-authored steps). */
  locatorQuality?: LocatorQuality;
  /** Ranked runtime fallbacks the runner tries when the primary is missing/ambiguous (from Recorder). */
  locatorAlternatives?: LocatorCandidate[];
  /** Container/frame scoping applied to the primary and every alternative (from Recorder). */
  locatorContext?: LocatorContext;
  /**
   * Which value source drives this node. `"none"` is a designer-only sentinel meaning "a bare
   * `value` with no explicit source" (e.g. a condition expression); it round-trips as `value` alone
   * without fabricating a static `valueSource`. It never appears in a persisted {@link ValueSource}.
   * See bead awkit-cxa.
   */
  valueSourceType: ValueSourceType | "none";
  value: string;
  // Dynamic JSON binding:
  dataSourceScope: DataSourceScope;
  dataSourceId: string;
  idMode: DynamicIdMode;
  objectId: string;
  keyName: string;
  timeoutMs: number;
  beforeWaits: WaitCondition[];
  afterWaits: WaitCondition[];
  /** Async completion policy for `afterWaits` (undefined = allRequired). Carried through round-trip. */
  completionMode?: FlowStep["completionMode"];
  retryCount: number;
  retryDelayMs: number;
  failureAction: NonNullable<FlowStep["onFailure"]>["action"];
  screenshotOnFailure: boolean;
  outputKey: string;
  validationState: ValidationState;

  // ── Canvas node size (Phase 6C) ──────────────────────────────────────────────
  width: number;
  height: number;

  // ── Type-specific properties (Phase 6A) ──────────────────────────────────────
  clearBeforeFill: boolean;
  selectionMode: "value" | "label" | "index";
  selectMultiple: boolean;
  waitType: "time" | "selector" | "navigation" | "networkIdle" | "textVisible";
  assertionType: "visible" | "text" | "value" | "count" | "url";
  comparisonOperator: "equals" | "contains" | "greaterThan" | "lessThan";
  expectedValue: string;
  screenshotName: string;
  fullPage: boolean;
  scrollTarget: "page" | "element";
  scrollDirection: "up" | "down" | "left" | "right";
  scrollAmount: number;
  loopType: "fixedCount" | "elements" | "dataRows";
  iterationCount: number;
  loopActionType: "click" | "fill" | "scroll" | "delete" | "customFlow";
  loopStopOnFailure: boolean;
  maxIterations: number;
  targetFlowId: string;
  stopParentOnChildFailure: boolean;

  // ── Route Change (Task 05) ───────────────────────────────────────────────────
  routeMode: "switchToUrl" | "switchToLatestTab" | "waitForNewTab" | "navigateCurrentPage";
  urlMatch: "exact" | "contains" | "regex";
  routeWaitUntil: "domcontentloaded" | "load" | "networkidle";

  // ── Save Session ─────────────────────────────────────────────────────────────
  sessionName: string;
  sessionFolder: string;
  overwriteSession: boolean;
  captureScope: "context" | "origin";
  maskSession: boolean;

  // ── Protected Login Handoff ──────────────────────────────────────────────────
  loginProvider: "auto" | "google" | "microsoft" | "okta" | "auth0" | "duo" | "other";
  handoffMode: "pauseAndAsk" | "openSystemBrowserOAuth" | "useSavedSession" | "useTestSession" | "cancel";
  handoffInstructions: string;
  allowRetry: boolean;
  handoffTimeoutMs: number;
  detectBeforeHandoff: boolean;

  // ── Reuse Session ────────────────────────────────────────────────────────────
  reuseSessionMode: "autoDetect" | "selected";
  reuseSessionId: string;

  // ── Oracle query node (nested config; present only on `oracle` steps) ─────────
  oracle?: OracleNodeConfig;

  // ── Dynamic connector ports (Point 1, render-only — not persisted to FlowStep) ──
  portFlags?: ConnectorPortFlags;
  /** Contextual-picker append affordance (render-only; never serialized). */
  isLeaf?: boolean;
  onAppendNode?: (nodeId: string, anchor: HTMLElement) => void;
  /** Per-node kebab menu actions (render-only; never serialized). */
  onConfigure?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  /** Whether this node currently carries a self-loop connector (render-only). */
  hasLoop?: boolean;
  /** Toggle the node's self-loop connector from its kebab menu (render-only). */
  onToggleLoop?: (nodeId: string) => void;
}

export const DEFAULT_NODE_WIDTH = 320;
export const DEFAULT_NODE_HEIGHT = 96;

/** A fresh Oracle node config (read-only, sensible limits, string return by default). */
export const defaultOracleNodeConfig = (): OracleNodeConfig => ({
  connectionSource: "dataSource",
  dataSourceId: "",
  connectionProfileId: "",
  sql: "",
  binds: [],
  timeoutMs: 30000,
  maxRows: 10000,
  fetchSize: 200,
  returnType: "list",
  selectedColumn: "",
  selectedRowIndex: 0,
  emptyBehavior: "null",
  defaultValue: "",
  multiRowBehavior: "first",
  listMode: "rows",
  booleanTrueValues: "Y,1,true,YES",
  booleanFalseValues: "N,0,false,NO",
  outputVariable: ""
});

export const defaultNodeData = (stepType: StepType, label: string, description: string): FlowDesignerNodeData => ({
  stepType,
  name: label,
  description,
  locatorStrategy: "role",
  locatorValue: "",
  locatorName: "",
  locatorExact: false,
  locatorQuality: undefined,
  locatorAlternatives: undefined,
  locatorContext: undefined,
  valueSourceType: "static",
  value: stepType === "goto" ? "${BASE_URL}/login" : "",
  dataSourceScope: "workflow",
  dataSourceId: "",
  idMode: "instanceOrder",
  objectId: "",
  keyName: "",
  timeoutMs: 10000,
  beforeWaits: [],
  afterWaits: [],
  retryCount: 0,
  retryDelayMs: 1000,
  failureAction: "stop",
  screenshotOnFailure: true,
  outputKey: "",
  validationState: "valid",
  width: DEFAULT_NODE_WIDTH,
  height: DEFAULT_NODE_HEIGHT,
  clearBeforeFill: false,
  selectionMode: "value",
  selectMultiple: false,
  waitType: stepType === "wait" ? "time" : "selector",
  assertionType: stepType === "assertVisible" ? "visible" : "text",
  comparisonOperator: "equals",
  expectedValue: "",
  screenshotName: "",
  fullPage: false,
  scrollTarget: "page",
  scrollDirection: "down",
  scrollAmount: 500,
  loopType: "fixedCount",
  iterationCount: 3,
  loopActionType: "click",
  loopStopOnFailure: true,
  maxIterations: 100,
  targetFlowId: "",
  stopParentOnChildFailure: true,
  routeMode: "switchToLatestTab",
  urlMatch: "contains",
  routeWaitUntil: "load",
  sessionName: "",
  sessionFolder: "",
  overwriteSession: false,
  captureScope: "context",
  maskSession: true,
  loginProvider: "auto",
  handoffMode: "pauseAndAsk",
  handoffInstructions: "",
  allowRetry: true,
  handoffTimeoutMs: 0,
  detectBeforeHandoff: true,
  reuseSessionMode: "autoDetect",
  reuseSessionId: "",
  oracle: stepType === "oracle" ? defaultOracleNodeConfig() : undefined
});
