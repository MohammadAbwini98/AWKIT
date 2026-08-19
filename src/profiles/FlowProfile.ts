export type StepType =
  | "start"
  | "goto"
  | "click"
  /** Double-click. Distinct from two `click` steps on purpose: two ordinary clicks replayed with a
      gap between them do not reliably re-fire `dblclick`, so they cannot stand in for this. */
  | "dblclick"
  /** Right-click / context menu. Captures the GESTURE only — whatever a user picks from a native
      browser menu is invisible to the page, the recorder and replay alike, so no step claims it. */
  | "contextMenu"
  | "press"
  | "drag"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "radio"
  | "scroll"
  | "hover"
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
  /** Number of those matches that were visible under the Recorder's live-DOM policy. */
  visibleMatchCount?: number;
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
  disambiguation?: "compound" | "container" | "shadow" | "positional";
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
  type: "dialog" | "tableRow" | "card" | "listItem" | "landmark" | "form" | "section";
  /** Narrow repeated containers (rows/cards) to the one whose text matches. */
  hasText?: string;
  /** Prefer the single *visible* container (hidden modal template + visible modal). */
  visibleOnly?: boolean;
}

/**
 * The target lives inside an iframe. A single legacy `frame` is resolved via `page.frameLocator(selector)`;
 * an ordered {@link LocatorContext.frameChain} is resolved frame-by-frame through Playwright's Frame graph
 * (so it works across cross-origin boundaries and never touches a child document from the parent). The
 * identity hints below are the iframe ELEMENT's parent-side attributes — stable across the child frame's
 * own navigation — and are used to verify a positional/ambiguous match so replay never enters a sibling frame.
 */
export interface LocatorFrameContext {
  /** CSS selector for the `<iframe>` element in its PARENT frame's document. */
  selector: string;
  /** iframe `name` attribute (identity hint). */
  name?: string;
  /** iframe `title` attribute (identity hint). */
  title?: string;
  /** iframe resolved `src` as origin+pathname (query/fragment dropped); identity hint. */
  url?: string;
  /** Positional index among `selector` matches in the parent, used ONLY with identity verification. */
  index?: number;
}

export type ShadowBoundaryState = "none" | "open" | "closed" | "unknown";

/** A stable locator for one host in an outer-to-inner open-shadow chain. */
export interface LocatorShadowHost extends LocatorCandidate {
  quality?: LocatorQuality;
  alternatives?: LocatorCandidate[];
}

/** Optional Shadow DOM scope captured by the Recorder. */
export interface LocatorShadowContext {
  boundary: ShadowBoundaryState;
  hosts?: LocatorShadowHost[];
  /**
   * A closed root was captured through the runner's instrumentation bridge, not ordinary CSS
   * piercing. When true, the runner resolves this chain via the closed-shadow resolver and MUST NOT
   * hand `target`/host values to `page.locator()` as plain selectors.
   */
  instrumented?: boolean;
  /** Resilient signature for the target inside the innermost (closed) root; used by the bridge resolver. */
  target?: LocatorCandidate;
}

export interface LocatorContext {
  frame?: LocatorFrameContext;
  /**
   * Ordered outer→inner iframe chain for a target that may live several frames deep (including
   * cross-origin). When present and non-empty it is authoritative; otherwise the single legacy
   * `frame` is read as a one-segment chain. Each segment's `selector` is resolved in its parent
   * frame's context via `frameLocator`.
   */
  frameChain?: LocatorFrameContext[];
  shadow?: LocatorShadowContext;
  /**
   * Ordered outer-to-inner semantic scopes. When present and non-empty this is authoritative;
   * otherwise legacy `container` is interpreted as a one-segment chain.
   */
  containers?: LocatorContainerContext[];
  /** Legacy one-segment container scope; retained for saved-flow compatibility. */
  container?: LocatorContainerContext;
}

export const MAX_LOCATOR_CONTAINER_CHAIN = 3;

/** Authoritative backward-compatible interpretation of locator container scope. */
export function locatorContainerChain(context?: LocatorContext): LocatorContainerContext[] {
  if (context?.containers?.length) return context.containers.slice();
  return context?.container ? [context.container] : [];
}

/** Authoritative backward-compatible interpretation of locator frame scope (outer→inner). */
export function locatorFrameChain(context?: LocatorContext): LocatorFrameContext[] {
  if (context?.frameChain?.length) return context.frameChain.slice();
  return context?.frame ? [context.frame] : [];
}

/** Stable, serializable event evidence; never contains DOM handles or page object references. */
export interface LocatorInteractionEvidence {
  path?: string[];
  x?: number;
  y?: number;
  matchIndex?: number;
  requiresHover?: boolean;
  hoverContainer?: Record<string, unknown>;
  hoverUnresolved?: boolean;
  /** The hover prerequisite came from insertion evidence rather than hidden-at-rest visibility. */
  hoverInserted?: boolean;
  /** Why hover attribution was refused, when `hoverUnresolved` is set. */
  hoverReviewReason?: string;
  shadowBoundary?: ShadowBoundaryState;
  frame?: {
    state: "same-origin" | "cross-origin" | "unknown";
    name?: string;
    origin?: string;
  };
}

/**
 * Hashed, privacy-preserving identity fingerprint of a target element. Every token is a SHA-256
 * hash (see the runner's `hashFingerprint`), never raw page text/labels/attribute values — so it is
 * safe to persist inside a saved flow. The shape lives here (not in the runner) because it is now
 * saved schema via {@link LocatorGuard}; the runner owns the computation.
 */
export interface LocatorElementFingerprint {
  tag: string;
  role: string;
  name: string;
  text: string;
  attributes: Record<string, string>;
  ancestry: string[];
}

/** Versioned evidence describing the exact element selected by the user. */
export interface ElementIdentityContract {
  schemaVersion: 1;
  primary: LocatorCandidate;
  alternatives?: LocatorCandidate[];
  owner: {
    tag: string;
    role?: string;
    accessibleName?: string;
    type?: string;
  };
  context?: LocatorContext;
  /** Raw during capture; every persisted token is hashed by buildRecordedFlow. */
  fingerprint?: LocatorElementFingerprint;
  structural?: {
    candidateSelector?: string;
    candidateIndex?: number;
    candidateCount?: number;
    siblingIndex?: number;
    sameTagIndex?: number;
    documentOrder?: number;
  };
  geometry?: {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
  };
  captureEvidence?: {
    composedPathTags?: string[];
    capturedAtUrl?: string;
    frameKey?: string;
    pageKey?: string;
  };
  confidence: {
    level: "exact" | "high" | "medium" | "guarded";
    basis: string[];
  };
}

/** Actionability evidence is deliberately independent from element identity. */
export interface InteractionPrerequisiteContract {
  schemaVersion: 1;
  status: "none" | "resolved" | "unknown";
  hover?: {
    required: boolean;
    resolved: boolean;
    inserted?: boolean;
    reason?: string;
  };
}

/** Material action/identity fields a user prerequisite decision is granted for. */
export interface InteractionDecisionBinding {
  version: 1;
  stepType: string;
  stepName: string;
  locator: LocatorCandidate;
  context?: LocatorContext;
  identity: ElementIdentityContract;
  prerequisite: InteractionPrerequisiteContract;
  safety?: StepSafetyPolicy;
}

/**
 * Execution policy for an unknown interaction prerequisite. This is deliberately separate from
 * locator resolution: identity can be resolved while execution is trial-gated or blocked.
 */
export interface InteractionExecutionDecisionContract {
  schemaVersion: 1;
  status: "automatic" | "user-confirmed" | "blocked";
  reason?: string;
  /** Required only for user confirmation; exact structural comparison invalidates stale authority. */
  binding?: InteractionDecisionBinding;
}

/**
 * A semantic check evaluated immediately before a sensitive guarded action (e.g. the dialog title,
 * the button's accessible name, an expected record id or amount). `expected` is a non-secret hashed
 * token under the same policy as {@link LocatorElementFingerprint} — it never stores raw secrets.
 */
export interface SemanticPrecondition {
  kind: "accessibleName" | "dialogTitle" | "buttonName" | "recordId" | "amount" | "selectedCount" | "url" | "labelContent";
  expected: string;
}

/**
 * Runtime identity guard for a positional locator. Its presence marks the locator
 * "guarded-positional": before acting, the runner
 * resolves `container`, re-selects candidate `index`, recomputes the target's fingerprint and proves
 * it still matches `fingerprint` (and every `preconditions` check, and that `siblingCount` and the
 * container/role/name/context are unchanged). Any mismatch aborts before the interaction. It never
 * falls back to another sibling or acts on position alone; sensitive actions additionally retain
 * their stricter error and no-broad-recovery policy.
 */
export interface LocatorGuard {
  /** Stable container chain (outer→inner) the positional index is resolved inside. */
  container?: LocatorContainerContext[];
  /**
   * CSS selector that enumerates the candidate set inside the container (the positional index picks
   * one). The runtime counts these, compares the count to `siblingCount`, then verifies the element
   * at `index` still matches `fingerprint` before acting.
   */
  candidateSelector: string;
  /** Hashed identity fingerprint of the recorded target. */
  fingerprint: LocatorElementFingerprint;
  /** Candidate count inside the container at record time. */
  siblingCount: number;
  /** Zero-based index of the recorded target among those candidates. */
  index: number;
  /** Required match strength before the action may proceed. */
  confidence: "exact" | "high";
  /** Semantic checks evaluated immediately before the action. */
  preconditions?: SemanticPrecondition[];
}

export type LocatorResolution =
  | "resolved"
  | "needs-review"
  | "user-approved-fallback"
  | "invalid";

/**
 * Exact, optional binding for a user-approved positional fallback. It intentionally repeats only
 * the fields whose mutation could retarget the action; comparing the object is collision-free and
 * keeps stale approval detection deterministic in the browser, main process, validator, and runner.
 */
export interface LocatorApprovalBinding {
  version: 1;
  stepType: string;
  stepName: string;
  locator: LocatorCandidate;
  context?: LocatorContext;
  safety?: StepSafetyPolicy;
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
  /** Compact capture evidence retained for diagnostics and compatible round trips. */
  interaction?: LocatorInteractionEvidence;
  /** Versioned multi-signal identity captured from the exact event target. */
  identity?: ElementIdentityContract;
  /** Conditions required to make the target actionable; never conflated with identity quality. */
  prerequisite?: InteractionPrerequisiteContract;
  /** Runtime/user decision for an unknown prerequisite; independent from locator resolution. */
  executionDecision?: InteractionExecutionDecisionContract;
  /** Resolution state of the locator. Absent means a legacy "resolved" step. */
  resolution?: LocatorResolution;
  /** Provenance of the resolution decision. */
  resolvedBy?: "recorder" | "user";
  /** Reason provided by the user when accepting a fallback locator. */
  approvedFallbackReason?: string;
  /** Material locator/action fields the approval was granted for. */
  approvedFallbackBinding?: LocatorApprovalBinding;
  /** Recorder-provided reason for an explicit review-required boundary. */
  reviewReason?: string;
  /**
   * Runtime identity guard for a positional locator. Present ⇒ "guarded-positional": the runner
   * re-proves the target's identity before acting (see {@link LocatorGuard}).
   */
  guard?: LocatorGuard;
  /**
   * Page-level blueprint element id for position-guided recovery. When present, the runner can load the
   * blueprint for this page key and use the element's captured positional/structural evidence as a second
   * recovery layer after `recoverLocally()` fails. Absent on legacy and pre-blueprint steps.
   */
  blueprintId?: string;
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

export type SmartWaitRequirement = "required" | "optional" | "advisory";
export type SmartWaitConfidenceLevel = "high" | "medium" | "low";

/** Privacy-safe Recorder evidence used to decide whether an inferred wait may gate replay. */
export interface SmartWaitEvidence {
  schemaVersion: 1;
  signalType: string;
  requirement: SmartWaitRequirement;
  confidence: { level: SmartWaitConfidenceLevel; score?: number; basis: string[] };
  causality: {
    actionId?: string;
    actionType?: string;
    observedAt: number;
    actionAt?: number;
    transitionStartedAt?: number;
    transitionCompletedAt?: number;
    competingCause?: "navigation" | "click" | "focus" | "timer" | "background" | "unknown";
    attributable: boolean;
  };
  /** Hashed Element Identity Contract; never raw page text or customer data. */
  targetIdentity?: ElementIdentityContract;
  preState?: Record<string, boolean | number | string | null>;
  postState?: Record<string, boolean | number | string | null>;
  replayPolicy?: { timeoutMs?: number; failureMode: "fail" | "warn" | "ignore" };
  dominance?: { rank: number; dominant?: boolean; supersededBy?: string };
}

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
  /** Present on newly Recorder-inferred waits. Absent preserves legacy/manual semantics. */
  evidence?: SmartWaitEvidence;
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
  | (WaitConditionBase & { type: "fixedDelay"; delayMs: number })
  /**
   * OR-group (grouped completion composition — awkit-y24). Passes as soon as ANY child condition
   * passes; fails only when every child fails. It is one condition in its parent's `afterWaits`, so
   * `allRequired` can hold a *required* OR-group — this is how `A AND (B OR C)` is expressed, e.g.
   * `response` (API success) AND `anyOf: [tableHasRows, emptyStateVisible]`. Because a required group
   * still gates the step, a successful API status alone never overrides a missing required UI outcome.
   *
   * v1 scope: children are UI-outcome / non-armed waits resolved after the action (the concrete gap is
   * `tableHasRows OR emptyStateVisible`). A `response` child with `armBeforeAction` is NOT pre-armed
   * inside a group — arm such responses at the top level instead. Nesting is permitted by the type and
   * resolved recursively by the runner.
   */
  | (WaitConditionBase & { type: "anyOf"; conditions: WaitCondition[] })
  /**
   * Asynchronous job polling (awkit-4km, C1). For the `202 Accepted → poll a status endpoint until
   * it reaches a terminal state` pattern. The runner OBSERVES the page's own repeated status
   * responses to `urlContains` (it issues no requests itself) and completes when a response is
   * terminal — either its status falls in `terminalStatusRange` (and is not `pollingStatus`), or a
   * JSON `responseField` (dot-path) equals one of `terminalValues`. A response with `pollingStatus`
   * (default 202) means "still processing → keep polling". Bounded by `maxAttempts` and `timeoutMs`.
   * WebSocket/SSE lifecycle and CDP diagnostics use the separate observational `streamActivity`
   * condition below; polling remains a completion gate.
   */
  | (WaitConditionBase & {
      type: "apiPolling";
      /** URL substring the status/poll responses must contain. */
      urlContains: string;
      method?: WaitHttpMethod;
      /** Status that means "still processing, keep polling". Default 202. */
      pollingStatus?: number;
      /** Status range considered a terminal success. Default [200, 299]. */
      terminalStatusRange?: [number, number];
      /** Dot-path into the JSON body whose value signals terminal state (e.g. `status`). */
      responseField?: string;
      /** Values of `responseField` that mean the job finished (e.g. `["succeeded", "failed"]`). */
      terminalValues?: string[];
      /** Max number of poll responses to observe before failing. Default 30. */
      maxAttempts?: number;
    })
  /**
   * Non-gating WebSocket/SSE lifecycle observation (awkit-4km C2). The runner arms this before the
   * action, records only redacted lifecycle/network metadata, and reports what it observed after the
   * real completion waits resolve. It NEVER proves completion: configure a required UI outcome
   * alongside it. Chromium uses CDP for richer request ids/timing/redirects when available; other
   * engines fall back to Playwright events.
   */
  | (WaitConditionBase & {
      type: "streamActivity";
      transport: "websocket" | "sse" | "either";
      /** Optional matcher used only in memory. Diagnostic output never includes the raw value. */
      urlContains?: string;
      /** Lifecycle event of interest for review/display. Observation remains non-gating. */
      event?: "open" | "message" | "close";
      /** Disable request-level diagnostics while retaining stream lifecycle observation. */
      diagnostics?: "auto" | "none";
    });

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
  /**
   * Drop target for a `drag` step. The `locator` is the drag SOURCE; `targetLocator` is where it is
   * dropped. Absent on all non-drag steps; a `drag` step without it fails at runtime.
   */
  targetLocator?: StepLocator;
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

/** Stable machine code for a structural connector rule (Stage 2b). */
export type ConnectorStructureCode =
  /** A structured `loop` connector whose source and target differ. */
  | "loopConnectorSpansNodes"
  /** A node with more than one standard (non-conditional/non-parallel) outgoing connector. */
  | "multipleStandardOutgoing"
  /** A non-conditional additional outgoing connector on a self-looping node. */
  | "loopSiblingNotConditional";

/**
 * One structural connector violation, with its location as data rather than only prose.
 * `severity` is always `"error"` — the runner refuses to execute any flow carrying one.
 */
export interface ConnectorStructureFinding {
  readonly code: ConnectorStructureCode;
  readonly severity: "error";
  /** The offending connector. Absent for `multipleStandardOutgoing`, which is a per-node rule. */
  readonly edgeId?: string;
  /** Source node of the offending connector, or the over-connected node itself. */
  readonly sourceNodeId: string;
  /** Target node of the offending connector, where the rule concerns a single connector. */
  readonly targetNodeId?: string;
  /** Human-readable message — byte-identical to the legacy `validateConnectorStructure` string. */
  readonly message: string;
}

/**
 * Structural connector safeguards (Points 2–4), shared by the Flow Designer UI and the
 * runner so an invalid flow can't execute even if it somehow bypasses the UI validation:
 *  - a node may have at most one standard (non-conditional/non-parallel) outgoing edge;
 *  - a loop connector's source and target must be the same node;
 *  - a node with a self-loop connector may only route additional outgoing edges as Conditional.
 *
 * This is the single implementation. `validateConnectorStructure` below is a thin string wrapper
 * kept for the runner and legacy callers — the two can never disagree.
 */
export function validateConnectorStructureDetailed(edges: FlowEdge[]): ConnectorStructureFinding[] {
  const findings: ConnectorStructureFinding[] = [];

  // Only the new structured `loop` kind is self-only; the legacy `loopBack` edge type
  // (Enhanced Connectors, Phase 1) is an intentional cross-node back-edge and is exempt.
  edges.forEach((edge) => {
    const isStructuredLoop = edge.kind === "loop" || edge.type === "loop";
    if (isStructuredLoop && edge.source !== edge.target) {
      findings.push({
        code: "loopConnectorSpansNodes",
        severity: "error",
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        message: `Loop connector ${edge.id} is invalid because it does not return to the same node.`
      });
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
      findings.push({
        code: "multipleStandardOutgoing",
        severity: "error",
        sourceNodeId: source,
        message: `Node ${source} has multiple standard outgoing connectors — routing would be ambiguous.`
      });
    }
  });

  const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && connectorKind(edge) === "loop").map((edge) => edge.source));
  edges.forEach((edge) => {
    if (!loopSources.has(edge.source) || edge.source === edge.target) return;
    if (connectorKind(edge) !== "conditional") {
      findings.push({
        code: "loopSiblingNotConditional",
        severity: "error",
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        message: `Node ${edge.source} has a loop connector; additional outgoing connectors must be Conditional.`
      });
    }
  });

  return findings;
}

/**
 * Legacy string view of {@link validateConnectorStructureDetailed}. Kept because the runner's
 * runtime gate (`FlowExecutor`) and the designer surface these strings directly.
 */
export function validateConnectorStructure(edges: FlowEdge[]): string[] {
  return validateConnectorStructureDetailed(edges).map((finding) => finding.message);
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
