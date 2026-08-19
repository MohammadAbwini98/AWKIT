import type { DataSourceScope, DialogExpectation, DynamicIdMode, ElementIdentityContract, FlowStep, InteractionExecutionDecisionContract, InteractionPrerequisiteContract, LocatorApprovalBinding, LocatorCandidate, LocatorContext, LocatorGuard, LocatorInteractionEvidence, LocatorQuality, LocatorStrategy, OracleNodeConfig, PageAlias, PopupExpectation, StepLocator, StepSafetyPolicy, StepType, ValueSource, ValueSourceType, WaitCondition } from "@src/profiles/FlowProfile";
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
  /** Compact Recorder evidence preserved through designer edits. */
  locatorInteraction?: LocatorInteractionEvidence;
  /** Exact event-owner identity captured by Recorder. */
  locatorIdentity?: ElementIdentityContract;
  /** Actionability prerequisite status, independent from identity. */
  locatorPrerequisite?: InteractionPrerequisiteContract;
  /** Runtime/user execution decision for an unknown actionability prerequisite. */
  locatorExecutionDecision?: InteractionExecutionDecisionContract;
  /** Resolution state of the locator (from Recorder). */
  locatorResolution?: "resolved" | "needs-review" | "user-approved-fallback" | "invalid";
  /** Provenance of the resolution decision (from Recorder). */
  locatorResolvedBy?: "recorder" | "user";
  /** Reason provided by the user when accepting a fallback locator. */
  locatorApprovedFallbackReason?: string;
  /** Exact locator/context/action fields the fallback approval was granted for. */
  locatorApprovedFallbackBinding?: LocatorApprovalBinding;
  /** Recorder explanation for a review-required locator boundary. */
  locatorReviewReason?: string;
  /** Runtime identity guard for a guarded-positional locator on a sensitive step (from Recorder). */
  locatorGuard?: LocatorGuard;
  /** Optional bounded-recovery reference; preserved verbatim through designer edits. */
  locatorBlueprintId?: string;
  /**
   * Drop target for a `drag` step (the source is `locator*` above). Carried verbatim through the
   * designer round-trip — "preserve, don't re-derive" — so editing or re-saving a recorded drag step
   * never drops its drop target. Absent on non-drag nodes.
   */
  targetLocator?: StepLocator;
  /**
   * Which value source drives this node. `"none"` is a designer-only sentinel meaning "a bare
   * `value` with no explicit source" (e.g. a condition expression); it round-trips as `value` alone
   * without fabricating a static `valueSource`. It never appears in a persisted {@link ValueSource}.
   * See bead awkit-cxa.
   */
  valueSourceType: ValueSourceType | "none";
  /**
   * The step's literal value (`FlowStep.value`), and for `goto` also its URL.
   *
   * This is the *literal only*. It used to double as the parameter of whatever value source the
   * step carried — the env var name, the output key, the generator id — which meant a save
   * reconstructed the typed source from this one string and corrupted it. The source now travels
   * separately in {@link FlowDesignerNodeData.valueSourceOriginal}.
   */
  value: string;
  /**
   * The step's value source exactly as it was loaded.
   *
   * The properties panel can only author two kinds, `static` and `dynamic`; every other kind
   * (`env`, `runtimeInput`, `json`, `flowOutput`, `generated`, `currentRow`, `instanceVariable`,
   * `secret`) is produced by the Recorder, an import, or a hand-edited profile. The designer's job
   * for those is to preserve them untouched, so they are carried here and written back verbatim.
   */
  valueSourceOriginal?: ValueSource;
  // ── Recorder-owned pass-through (preserved verbatim; the designer has no UI to author these) ──
  /** Explicit side-effect safety policy (`FlowStep.safety`); authoritative for retry decisions. */
  safety?: StepSafetyPolicy;
  /** Which browser page/window this step targets (`FlowStep.pageAlias`); recorder-set for popups. */
  pageAlias?: PageAlias;
  /** True when this step opens a popup/window (`FlowStep.opensPopup`); arms popup capture at run time. */
  opensPopup?: boolean;
  /** Popup the step opens (`FlowStep.popupExpectation`); required downstream by switchToPopup/closePopup. */
  popupExpectation?: PopupExpectation;
  /** Native JS dialog this step answers (`FlowStep.dialogExpectation`). Armed before the action. */
  dialogExpectation?: DialogExpectation;
  /** Load condition for a `goto` step (`FlowStep.waitUntil`). */
  waitUntil?: FlowStep["waitUntil"];
  /**
   * The step's full `outputs` map, preserved verbatim. The panel edits a single {@link outputKey},
   * but a step may declare several typed outputs; carrying the map here keeps the rest untouched
   * instead of collapsing them to `{ [key]: { type: "text" } }`.
   */
  outputsOriginal?: Record<string, unknown>;
  /** Loop binding for `loop`-carrying steps (`FlowStep.loop`); not designer-editable, pass-through. */
  loop?: FlowStep["loop"];
  /** Free-text step message (`FlowStep.message`); not designer-editable, pass-through. */
  message?: string;
  /**
   * Optional step fields that were **absent** on the loaded profile, so `toFlowStep` can omit them
   * again rather than writing back a default the user never set (keeps a no-op open+save byte-stable).
   * Undefined for nodes created in the designer, which emit their defaults as before.
   */
  absentOnLoad?: readonly string[];
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
  assertionType: "visible" | "text" | "value" | "count" | "url" | "attribute" | "storage";
  /** Attribute read by an `attribute` assertion (e.g. `aria-pressed`). Empty for other types. */
  attributeName: string;
  /** Browser storage area read by a `storage` assertion. */
  storageArea: "local" | "session";
  /** Storage key read by a `storage` assertion. Empty for other types. */
  storageKey: string;
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
  /** Open the existing self-loop connector in the connection inspector (render-only). */
  onConfigureLoop?: (nodeId: string) => void;
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
  locatorInteraction: undefined,
  locatorIdentity: undefined,
  locatorPrerequisite: undefined,
  locatorExecutionDecision: undefined,
  locatorResolution: undefined,
  locatorResolvedBy: undefined,
  locatorApprovedFallbackReason: undefined,
  locatorReviewReason: undefined,
  locatorGuard: undefined,
  locatorBlueprintId: undefined,
  pageAlias: undefined,
  opensPopup: undefined,
  popupExpectation: undefined,
  dialogExpectation: undefined,
  waitUntil: undefined,
  valueSourceType: "static",
  value: stepType === "goto" ? "${BASE_URL}/login" : "",
  valueSourceOriginal: undefined,
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
  attributeName: "",
  storageArea: "local",
  storageKey: "",
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
