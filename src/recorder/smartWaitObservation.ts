import type { WaitCondition, StepLocator, LocatorStrategy, WaitHttpMethod, SmartWaitEvidence } from "../profiles/FlowProfile";

/**
 * Smart Wait recorder observation (Phase 2) — the pure, browser-free half.
 *
 * The injected page script ({@link recorderInitScript}) watches the DOM/network between user
 * actions and emits raw {@link RecordedSignal}s. `RecorderService` buffers them and, when the next
 * distinct action is recorded, calls {@link buildSmartWaits} to turn the signals observed since the
 * previous action into `afterWaits` on that previous action. Keeping the correlation/scoring here
 * makes it unit-testable without a real browser.
 *
 * Security: signals carry only a request method + URL **path** (no query/hash), status, timings,
 * loader selectors, short toast text, and locators — never headers, bodies, cookies, or tokens.
 */

/** A locator captured page-side for a wait target (subset of {@link StepLocator}). */
export type SignalLocator = StepLocator;

type SignalCause = "navigation" | "click" | "focus" | "timer" | "background" | "unknown";
interface SignalContext { cause?: SignalCause; }

export type RecordedSignal =
  | ({ kind: "request"; method: string; path: string; status: number; startedAt: number; endedAt: number } & SignalContext)
  | ({ kind: "loaderHidden"; locator?: SignalLocator; selector: string; shownAt: number; hiddenAt: number; existedAtBaseline?: boolean } & SignalContext)
  | ({ kind: "toast"; locator?: SignalLocator; text?: string; role?: string; ts: number } & SignalContext)
  | ({ kind: "enabled"; locator: SignalLocator; ts: number; existedBefore?: boolean; preDisabled?: boolean; postDisabled?: boolean } & SignalContext)
  | ({ kind: "rows"; container: SignalLocator; listLike: boolean; previousCount?: number; count: number; ts: number } & SignalContext)
  | ({ kind: "url"; url: string; fromUrl?: string; ts: number } & SignalContext);

export interface SmartWaitBuildOptions {
  /** Minimum window duration (ms) before a `fixedDelay` fallback is considered. */
  minMeaningfulMs?: number;
  /** Max number of waits kept per window. */
  maxWaits?: number;
  /** Allow a `fixedDelay` fallback when no condition is detected (usually only when the
   * legacy fixed-time `captureWaitTime` node capture is OFF, to avoid double delays). */
  allowFixedDelayFallback?: boolean;
  /** Cap for a `fixedDelay` fallback (ms). */
  maxFixedDelayMs?: number;
  /** A request path repeated at least this many times in the window is treated as background
   * polling and ignored. */
  pollingThreshold?: number;
  // ── Adaptive dynamic timeout (async awareness) ──────────────────────────────
  /** Derive a realistic per-wait `timeoutMs` from the observed duration instead of the flat 30s
   *  runner default. When false, waits omit `timeoutMs` and the runner default applies. */
  adaptiveTimeouts?: boolean;
  /** Lower bound (ms) for an adaptive timeout. */
  minimumTimeoutMs?: number;
  /** Hard upper bound (ms) for an adaptive timeout — never exceeded. */
  maximumTimeoutMs?: number;
  /** Multiplier applied to the observed duration when computing an adaptive timeout. */
  timeoutMultiplier?: number;
  /** Flat safety margin (ms) added on top of `observed × multiplier`. */
  timeoutSafetyMarginMs?: number;
  /** Grace (ms) stamped on recorded loaders so a late-appearing spinner is not skipped on replay
   *  (two-phase loader lifecycle). 0 disables the lifecycle (legacy loaderHidden). */
  loaderAppearanceGraceMs?: number;
  actionId?: string;
  actionType?: string;
  causalWindowMs?: number;
}

const DEFAULTS: Required<SmartWaitBuildOptions> = {
  minMeaningfulMs: 400,
  maxWaits: 3,
  allowFixedDelayFallback: true,
  maxFixedDelayMs: 60_000,
  pollingThreshold: 3,
  adaptiveTimeouts: true,
  minimumTimeoutMs: 10_000,
  maximumTimeoutMs: 300_000,
  timeoutMultiplier: 3,
  timeoutSafetyMarginMs: 5_000,
  loaderAppearanceGraceMs: 1_500,
  actionId: "",
  actionType: "",
  causalWindowMs: 2_000
};

/**
 * Turn an observed duration into a realistic, bounded wait timeout:
 * `clamp(observed × multiplier + safetyMargin, minimum, maximum)`. Always clamped to `maximum` so a
 * slow-but-finite observation can never bake an unbounded timeout into a saved flow.
 */
export function adaptiveTimeoutMs(observedMs: number, opts: Required<SmartWaitBuildOptions>): number {
  const calc = Math.round(Math.max(0, observedMs) * opts.timeoutMultiplier + opts.timeoutSafetyMarginMs);
  return Math.min(Math.max(calc, opts.minimumTimeoutMs), opts.maximumTimeoutMs);
}

/** Priority order (most reliable first) used to rank and cap the waits kept per window. */
const PRIORITY: WaitCondition["type"][] = [
  "urlChanged",
  "response",
  "loaderHidden",
  "tableHasRows",
  "listHasItems",
  "toastVisible",
  "textVisible",
  "elementEnabled",
  "domStable",
  "fixedDelay"
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function tsOf(signal: RecordedSignal): number {
  if (signal.kind === "request") return signal.endedAt;
  if (signal.kind === "loaderHidden") return signal.hiddenAt;
  return signal.ts;
}

function normMethod(method: string): WaitHttpMethod | undefined {
  const m = (method || "").toUpperCase();
  return m === "GET" || m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE" ? (m as WaitHttpMethod) : undefined;
}

function toStepLocator(locator: SignalLocator): StepLocator {
  return { ...locator, strategy: locator.strategy as LocatorStrategy };
}

function hasStrongIdentity(locator?: SignalLocator): boolean {
  if (!locator) return false;
  const quality = locator.quality;
  return Boolean(locator.identity?.fingerprint && quality?.isUnique && quality.confidence === "high");
}

function evidence(
  signalType: string,
  requirement: SmartWaitEvidence["requirement"],
  level: SmartWaitEvidence["confidence"]["level"],
  basis: string[],
  observedAt: number,
  fromTs: number,
  opts: Required<SmartWaitBuildOptions>,
  cause: SignalCause = "unknown",
  target?: SignalLocator,
  states?: Pick<SmartWaitEvidence, "preState" | "postState">,
  rank = 0
): SmartWaitEvidence {
  return {
    schemaVersion: 1,
    signalType,
    requirement,
    confidence: { level, basis },
    causality: {
      actionId: opts.actionId || undefined,
      actionType: opts.actionType || undefined,
      observedAt,
      actionAt: fromTs,
      competingCause: cause,
      attributable: cause === "click" && observedAt - fromTs <= opts.causalWindowMs
    },
    targetIdentity: target?.identity,
    ...states,
    replayPolicy: { failureMode: requirement === "required" ? "fail" : requirement === "optional" ? "warn" : "ignore" },
    dominance: { rank }
  };
}

function applyEvidence<T extends WaitCondition>(wait: T, value: SmartWaitEvidence): T {
  wait.evidence = value;
  if (value.requirement !== "required") wait.optional = true;
  return wait;
}

function cssLocator(selector: string): StepLocator {
  return { strategy: "css", value: selector };
}

/** A distinctive, query-free fragment of a URL for a `urlChanged` wait. */
function urlFragment(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    const frag = (url.pathname && url.pathname !== "/" ? url.pathname : "") + (url.hash || "");
    return frag || undefined;
  } catch {
    return undefined;
  }
}

function orderByPriority(waits: WaitCondition[]): WaitCondition[] {
  return waits.slice().sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
}

/**
 * Build the smart waits describing what happened in the window `(fromTs, toTs]` — i.e. what the
 * user waited for after the previous action. Applies a polling filter, prioritization, and a cap;
 * falls back to a single `fixedDelay` only when no reliable condition is detected.
 */
export function buildSmartWaits(
  signals: RecordedSignal[],
  fromTs: number,
  toTs: number,
  options: SmartWaitBuildOptions = {}
): WaitCondition[] {
  const opts = { ...DEFAULTS, ...options };
  const inWindow = signals.filter((s) => tsOf(s) > fromTs && tsOf(s) <= toTs);
  const waits: WaitCondition[] = [];

  // 1. Network → `response` waits (highest priority). Only requests started after the previous
  //    action (i.e. triggered by it); repeated paths are treated as background polling.
  const requests = inWindow.filter(
    (s): s is Extract<RecordedSignal, { kind: "request" }> => s.kind === "request" && s.startedAt > fromTs
  );
  const byKey = new Map<string, Extract<RecordedSignal, { kind: "request" }>[]>();
  for (const req of requests) {
    const key = `${req.method} ${req.path}`;
    const arr = byKey.get(key) ?? [];
    arr.push(req);
    byKey.set(key, arr);
  }
  const responseReqs: Extract<RecordedSignal, { kind: "request" }>[] = [];
  for (const arr of byKey.values()) {
    if (arr.length >= opts.pollingThreshold) continue; // repeated → polling, ignore
    const best = arr.slice().sort((a, b) => b.endedAt - b.startedAt - (a.endedAt - a.startedAt))[0];
    if (best.status > 0) responseReqs.push(best); // skip aborted/failed (status 0)
  }
  responseReqs.sort(
    (a, b) =>
      (MUTATING_METHODS.has(a.method) ? 0 : 1) - (MUTATING_METHODS.has(b.method) ? 0 : 1) ||
      b.endedAt - b.startedAt - (a.endedAt - a.startedAt)
  );
  for (const req of responseReqs.slice(0, 2)) {
    const wait: WaitCondition = {
      type: "response",
      method: normMethod(req.method),
      urlContains: req.path,
      statusRange: [200, 399],
      armBeforeAction: true,
      reason: `${req.method} ${req.path} completed in ${Math.max(0, req.endedAt - req.startedAt)}ms after the action`
    };
    if (opts.adaptiveTimeouts) wait.timeoutMs = adaptiveTimeoutMs(req.endedAt - req.startedAt, opts);
    waits.push(applyEvidence(wait, evidence("network", "optional", "medium", ["safe request metadata", "single request in action window"], req.endedAt, fromTs, opts, req.cause, undefined, undefined, 40)));
  }

  // 2. Loader appeared then disappeared (only loaders that appeared after the previous action).
  const loader = inWindow.find(
    (s): s is Extract<RecordedSignal, { kind: "loaderHidden" }> => s.kind === "loaderHidden" && s.shownAt > fromTs
  );
  if (loader) {
    const wait: Extract<WaitCondition, { type: "loaderHidden" }> = {
      type: "loaderHidden",
      locator: loader.locator ? toStepLocator(loader.locator) : cssLocator(loader.selector),
      reason: "Loader appeared then disappeared"
    };
    if (opts.adaptiveTimeouts) wait.timeoutMs = adaptiveTimeoutMs(loader.hiddenAt - loader.shownAt, opts);
    // Two-phase loader lifecycle: give a late spinner a grace window to reappear on replay, but never
    // require it (optional appearance) so a faster backend can't fail the step.
    if (opts.loaderAppearanceGraceMs > 0) {
      wait.appearanceGraceMs = opts.loaderAppearanceGraceMs;
      wait.mustAppear = false;
      wait.completion = "hidden";
    }
    const strong = loader.cause === "click" && hasStrongIdentity(loader.locator) && !loader.existedAtBaseline;
    waits.push(applyEvidence(wait, evidence("loaderHidden", strong ? "required" : "advisory", strong ? "high" : "low", strong ? ["action-caused lifecycle", "stable target identity"] : ["loader causality or identity not proven"], loader.hiddenAt, fromTs, opts, loader.cause, loader.locator, { preState: { visible: true }, postState: { visible: false } }, 70)));
  }

  // 3. Table/list data appeared (the container that gained the most rows/items).
  const rows = inWindow
    .filter((s): s is Extract<RecordedSignal, { kind: "rows" }> => s.kind === "rows")
    .sort((a, b) => b.count - a.count)[0];
  if (rows) {
    const strong = rows.cause === "click" && hasStrongIdentity(rows.container) && typeof rows.previousCount === "number";
    const ev = evidence("rows", strong ? "required" : "advisory", strong ? "high" : "low", strong ? ["scoped count transition", "stable container identity"] : ["scoped causal transition not proven"], rows.ts, fromTs, opts, rows.cause, rows.container, { preState: { count: rows.previousCount ?? 0 }, postState: { count: rows.count } }, 65);
    if (rows.listLike) waits.push(applyEvidence({ type: "listHasItems", listLocator: toStepLocator(rows.container), minItems: 1, reason: "List items appeared" }, ev));
    else waits.push(applyEvidence({ type: "tableHasRows", tableLocator: toStepLocator(rows.container), minRows: 1, reason: "Table rows appeared" }, ev));
  }

  // 4. Toast/alert became visible.
  const toast = inWindow.find((s): s is Extract<RecordedSignal, { kind: "toast" }> => s.kind === "toast");
  if (toast) {
    const strong = toast.cause === "click" && hasStrongIdentity(toast.locator);
    waits.push(applyEvidence(
      toast.locator ? { type: "toastVisible", locator: toStepLocator(toast.locator), reason: "Toast/alert appeared" } : { type: "toastVisible", reason: "Toast/alert appeared" },
      evidence("toast", strong ? "optional" : "advisory", strong ? "medium" : "low", strong ? ["action-attributed stable status target"] : ["background or weak status observation"], toast.ts, fromTs, opts, toast.cause, toast.locator, undefined, 45)
    ));
  }

  // 5. Control became enabled.
  const enabled = inWindow.find((s): s is Extract<RecordedSignal, { kind: "enabled" }> => s.kind === "enabled");
  if (enabled) {
    const bounded = enabled.ts - fromTs <= opts.causalWindowMs;
    const strong = enabled.cause === "click" && bounded && enabled.existedBefore === true && enabled.preDisabled === true && enabled.postDisabled === false && hasStrongIdentity(enabled.locator);
    waits.push(applyEvidence(
      { type: "elementEnabled", locator: toStepLocator(enabled.locator), reason: "Control became enabled" },
      evidence("elementEnabled", strong ? "required" : "advisory", strong ? "high" : "low", strong ? ["same stable target", "disabled-to-enabled transition", "bounded action attribution"] : ["target identity or causal transition not proven"], enabled.ts, fromTs, opts, enabled.cause, enabled.locator, { preState: { disabled: enabled.preDisabled ?? null }, postState: { disabled: enabled.postDisabled ?? null } }, 60)
    ));
  }

  // 6. URL changed after the action.
  const urls = inWindow.filter((s): s is Extract<RecordedSignal, { kind: "url" }> => s.kind === "url");
  if (urls.length) {
    const frag = urlFragment(urls[urls.length - 1].url);
    if (frag) {
      const url = urls[urls.length - 1];
      const strong = url.cause === "click" && url.ts - fromTs <= opts.causalWindowMs;
      waits.push(applyEvidence(
        { type: "urlChanged", fromUrl: url.fromUrl ? urlFragment(url.fromUrl) : undefined, urlContains: frag, reason: "Route changed after the action" },
        evidence("route", strong ? "required" : "advisory", strong ? "high" : "low", strong ? ["trusted action route transition", "origin/path-only evidence"] : ["route attribution not proven"], url.ts, fromTs, opts, url.cause, undefined, undefined, 90)
      ));
    }
  }

  const dominant = waits.filter((wait) => wait.evidence?.requirement === "required").sort((a, b) => (b.evidence?.dominance?.rank ?? 0) - (a.evidence?.dominance?.rank ?? 0))[0];
  if (dominant?.evidence) {
    dominant.evidence.dominance = { rank: dominant.evidence.dominance?.rank ?? 0, ...dominant.evidence.dominance, dominant: true };
    for (const wait of waits) {
      if (wait === dominant || !wait.evidence) continue;
      if ((wait.evidence.dominance?.rank ?? 0) < (dominant.evidence.dominance?.rank ?? 0)) {
        wait.evidence.dominance = { rank: wait.evidence.dominance?.rank ?? 0, ...wait.evidence.dominance, supersededBy: dominant.evidence.signalType };
        if (wait.evidence.requirement === "required") {
          wait.evidence.requirement = "optional";
          wait.evidence.replayPolicy = { failureMode: "warn" };
          wait.optional = true;
        }
      }
    }
  }

  const ordered = orderByPriority(waits).slice(0, opts.maxWaits);

  // 7. Fixed-delay fallback only when no reliable condition was detected.
  if (ordered.length === 0 && opts.allowFixedDelayFallback) {
    const delta = toTs - fromTs;
    if (delta >= opts.minMeaningfulMs) {
      ordered.push(applyEvidence({
        type: "fixedDelay",
        delayMs: Math.min(Math.round(delta), opts.maxFixedDelayMs),
        reason: "No reliable condition detected; recorded think-time"
      }, evidence("thinkTime", "advisory", "low", ["no causal completion signal"], toTs, fromTs, opts, "unknown", undefined, undefined, 1)));
    }
  }

  return ordered;
}
