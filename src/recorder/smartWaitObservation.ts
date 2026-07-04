import type { WaitCondition, StepLocator, LocatorStrategy, WaitHttpMethod } from "../profiles/FlowProfile";

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
export interface SignalLocator {
  strategy: string;
  value: string;
  name?: string;
  exact?: boolean;
}

export type RecordedSignal =
  | { kind: "request"; method: string; path: string; status: number; startedAt: number; endedAt: number }
  | { kind: "loaderHidden"; selector: string; shownAt: number; hiddenAt: number }
  | { kind: "toast"; text?: string; role?: string; ts: number }
  | { kind: "enabled"; locator: SignalLocator; ts: number }
  | { kind: "rows"; container: SignalLocator; listLike: boolean; count: number; ts: number }
  | { kind: "url"; url: string; ts: number };

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
}

const DEFAULTS: Required<SmartWaitBuildOptions> = {
  minMeaningfulMs: 400,
  maxWaits: 3,
  allowFixedDelayFallback: true,
  maxFixedDelayMs: 60_000,
  pollingThreshold: 3
};

/** Priority order (most reliable first) used to rank and cap the waits kept per window. */
const PRIORITY: WaitCondition["type"][] = [
  "response",
  "loaderHidden",
  "tableHasRows",
  "listHasItems",
  "toastVisible",
  "textVisible",
  "elementEnabled",
  "urlChanged",
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
  const out: StepLocator = { strategy: locator.strategy as LocatorStrategy, value: locator.value };
  if (locator.name) out.name = locator.name;
  if (locator.exact) out.exact = true;
  return out;
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
    waits.push({
      type: "response",
      method: normMethod(req.method),
      urlContains: req.path,
      statusRange: [200, 399],
      armBeforeAction: true,
      reason: `${req.method} ${req.path} completed after the action`
    });
  }

  // 2. Loader appeared then disappeared (only loaders that appeared after the previous action).
  const loader = inWindow.find(
    (s): s is Extract<RecordedSignal, { kind: "loaderHidden" }> => s.kind === "loaderHidden" && s.shownAt > fromTs
  );
  if (loader) waits.push({ type: "loaderHidden", locator: cssLocator(loader.selector), reason: "Loader appeared then disappeared" });

  // 3. Table/list data appeared (the container that gained the most rows/items).
  const rows = inWindow
    .filter((s): s is Extract<RecordedSignal, { kind: "rows" }> => s.kind === "rows")
    .sort((a, b) => b.count - a.count)[0];
  if (rows) {
    if (rows.listLike) waits.push({ type: "listHasItems", listLocator: toStepLocator(rows.container), minItems: 1, reason: "List items appeared" });
    else waits.push({ type: "tableHasRows", tableLocator: toStepLocator(rows.container), minRows: 1, reason: "Table rows appeared" });
  }

  // 4. Toast/alert became visible.
  const toast = inWindow.find((s): s is Extract<RecordedSignal, { kind: "toast" }> => s.kind === "toast");
  if (toast) {
    waits.push(
      toast.text
        ? { type: "toastVisible", text: toast.text, reason: "Toast/alert appeared" }
        : { type: "toastVisible", reason: "Toast/alert appeared" }
    );
  }

  // 5. Control became enabled.
  const enabled = inWindow.find((s): s is Extract<RecordedSignal, { kind: "enabled" }> => s.kind === "enabled");
  if (enabled) waits.push({ type: "elementEnabled", locator: toStepLocator(enabled.locator), reason: "Control became enabled" });

  // 6. URL changed after the action.
  const urls = inWindow.filter((s): s is Extract<RecordedSignal, { kind: "url" }> => s.kind === "url");
  if (urls.length) {
    const frag = urlFragment(urls[urls.length - 1].url);
    if (frag) waits.push({ type: "urlChanged", urlContains: frag, reason: "URL changed after the action" });
  }

  const ordered = orderByPriority(waits).slice(0, opts.maxWaits);

  // 7. Fixed-delay fallback only when no reliable condition was detected.
  if (ordered.length === 0 && opts.allowFixedDelayFallback) {
    const delta = toTs - fromTs;
    if (delta >= opts.minMeaningfulMs) {
      ordered.push({
        type: "fixedDelay",
        delayMs: Math.min(Math.round(delta), opts.maxFixedDelayMs),
        reason: "No reliable condition detected; recorded think-time"
      });
    }
  }

  return ordered;
}
