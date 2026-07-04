import type { DataSourceScope, DynamicIdMode, FlowStep, LocatorQuality, LocatorStrategy, StepType, ValueSourceType, WaitCondition } from "@src/profiles/FlowProfile";
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
  valueSourceType: ValueSourceType;
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

  // ── Dynamic connector ports (Point 1, render-only — not persisted to FlowStep) ──
  portFlags?: ConnectorPortFlags;
}

export const DEFAULT_NODE_WIDTH = 220;
export const DEFAULT_NODE_HEIGHT = 96;

export const defaultNodeData = (stepType: StepType, label: string, description: string): FlowDesignerNodeData => ({
  stepType,
  name: label,
  description,
  locatorStrategy: "role",
  locatorValue: "",
  locatorName: "",
  locatorExact: false,
  locatorQuality: undefined,
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
  reuseSessionId: ""
});
