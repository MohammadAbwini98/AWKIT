/**
 * What each Smart Wait {@link WaitCondition} needs before the runner can execute it (`awkit-jtok`).
 *
 * WHY THIS EXISTS:
 * `FlowValidator` validated a step's `beforeWaits`/`afterWaits` for **timeouts only**. Nothing
 * checked that a condition carried the fields its own type requires, so an imported or hand-edited
 * profile holding an incomplete condition was admitted by the run gate and failed — or, worse,
 * silently *passed* — once the browser was already open and earlier steps had applied their side
 * effects. This is the same defect class as `awkit-3p6x` one level down: there, one step type hid
 * five different steps; here, one array element hides fifteen different conditions.
 *
 * THE CONTRACT IS READ OFF THE RUNTIME. `StepExecutor.executeWaitCondition` is the only executor of
 * these conditions, and it fails in two distinguishable ways that this module deliberately keeps
 * apart:
 *
 *  - **It throws.** `waitLocator(undefined)` → `LocatorFactory.create` throws "Locator is required";
 *    `waitForTimeout(NaN)` from an absent `delayMs`; an unknown `type` literal.
 *  - **It passes vacuously.** This is the more dangerous half, because nothing ever looks wrong.
 *    `urlChanged` with neither `urlContains` nor `fromUrl` returns `true` on the first poll.
 *    `getByText("")` matches every element on the page. A `response` with no method and no
 *    `urlContains` matches the very first response of any kind. Each of those is a wait that never
 *    waits — the step races on, and the flake shows up somewhere else entirely.
 *
 * SEVERITY MIRRORS THE RUNTIME, IT IS NOT A JUDGEMENT CALL. `runRequiredOrOptional` swallows a
 * failure when `wait.optional || wait.evidence?.requirement === "optional"`, logging
 * `WAIT_SIGNAL_OPTIONAL_MISSED` and continuing. So a malformed OPTIONAL condition cannot fail a run
 * and is reported as a warning; a malformed REQUIRED one will fail the step and is an error. Note
 * the runtime's check does **not** include `"advisory"` — the Recorder stamps `optional: true`
 * alongside any non-required evidence (`applyEvidence`), so recorder output resolves correctly, but
 * a hand-authored `requirement: "advisory"` with no `optional` flag really is required at run time.
 * {@link waitConditionBlocks} mirrors that exactly rather than the tidier reading.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { StepLocator, WaitCondition } from "../profiles/FlowProfile";

/** Every condition type in the union, exhaustively. */
export type WaitConditionType = WaitCondition["type"];

/**
 * Exhaustive `Record`, so `tsc --noEmit` — the repo's primary gate — fails the moment a condition
 * type is added to the union without deciding what it requires. The same reason
 * `STEP_REQUIREMENTS` is a `Record` rather than a list.
 */
const CONDITION_LABELS: Record<WaitConditionType, string> = {
  loaderHidden: "loader-hidden",
  elementVisible: "element-visible",
  elementHidden: "element-hidden",
  elementEnabled: "element-enabled",
  textVisible: "text-visible",
  toastVisible: "toast-visible",
  response: "response",
  tableHasRows: "table-has-rows",
  listHasItems: "list-has-items",
  urlChanged: "url-changed",
  domStable: "dom-stable",
  fixedDelay: "fixed-delay",
  anyOf: "OR-group",
  apiPolling: "api-polling",
  streamActivity: "stream-activity"
};

/** Every declared condition type, in table order. */
export const WAIT_CONDITION_TYPES: readonly WaitConditionType[] = Object.keys(CONDITION_LABELS) as WaitConditionType[];

const KNOWN_CONDITION_TYPES: ReadonlySet<string> = new Set<string>(WAIT_CONDITION_TYPES);

/** Whether a raw literal (e.g. from hand-edited JSON) names a condition the runner can execute. */
export function isKnownWaitConditionType(type: string): type is WaitConditionType {
  return KNOWN_CONDITION_TYPES.has(type);
}

/** How a condition is named in a validation message. */
export function waitConditionLabel(type: string): string {
  return isKnownWaitConditionType(type) ? CONDITION_LABELS[type] : `"${type}"`;
}

/** What is wrong with one condition, and whether the runner would actually be stopped by it. */
export interface WaitConditionDefect {
  /** Dotted path from the condition being validated, e.g. `` or `conditions[1]` for a nested branch. */
  readonly path: string;
  readonly type: string;
  /** Which class of rule this is, so the caller can pick a matching validation code. */
  readonly kind: "locator" | "value" | "bounds" | "configuration";
  /** The defect, phrased to name the field the user has to fix. */
  readonly detail: string;
}

/* ------------------------------------------------------------------ *
 * Field predicates
 * ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Whether a locator can actually resolve an element.
 *
 * A PRESENT-BUT-EMPTY locator is the shape that matters here, not an absent one: the designer's
 * "Add wait" scaffolds create `{ strategy: "css", value: "" }` for the user to fill in, and
 * `LocatorFactory.create` accepts that object happily — it only throws on `undefined` — so the
 * empty selector survives all the way to Playwright. Checking presence alone would let the entire
 * half-configured case through, which is the common one.
 */
function isUsableLocator(locator: StepLocator | undefined): boolean {
  return locator !== undefined && isNonEmptyString(locator.value);
}

/** An HTTP status range the runner can compare against, as `[lo, hi]` with `lo <= hi`. */
function isUsableStatusRange(range: unknown): boolean {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [lo, hi] = range as [unknown, unknown];
  const bounded = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599;
  return bounded(lo) && bounded(hi) && (lo as number) <= (hi as number);
}

/**
 * Guard against a pathological `anyOf` nest. The union permits nesting and the runner recurses, so a
 * hand-written or generated profile could nest deeply enough to matter. The cap is a validation
 * bound only — it never changes what the runner executes.
 */
export const MAX_WAIT_CONDITION_DEPTH = 8;

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

/**
 * Every way one condition is unexecutable or vacuous, deepest-nested branches included.
 *
 * Returns an empty array for a condition the runner can execute as configured. Optional fields are
 * only judged when PRESENT: a condition that omits a field with a documented runtime default is
 * complete, not defective, and reporting one would flag correct flows. Each rule below cites the
 * runtime behaviour it is protecting against.
 */
export function waitConditionDefects(wait: WaitCondition, path = "", depth = 0): WaitConditionDefect[] {
  const defects: WaitConditionDefect[] = [];
  const type = (wait as { type?: unknown }).type;
  const at = (kind: WaitConditionDefect["kind"], detail: string): void => {
    defects.push({ path, type: String(type), kind, detail });
  };

  if (typeof type !== "string" || !isKnownWaitConditionType(type)) {
    // `executeWaitCondition`'s `default:` arm throws "Unsupported wait condition type".
    at("configuration", `names a wait condition type the runner cannot execute`);
    return defects;
  }

  if (depth > MAX_WAIT_CONDITION_DEPTH) {
    at("configuration", `is nested more than ${MAX_WAIT_CONDITION_DEPTH} OR-groups deep`);
    return defects;
  }

  // `timeoutMs` is deliberately NOT checked here. `FlowValidator.validateTimeouts` already owns every
  // timeout in the profile — including the `highTimeout` warning, which this module has no notion of —
  // and reporting the same field from two rules would double-count one mistake in the designer's
  // "not runnable (N)" badge. That function now recurses into OR-group branches so the coverage is not
  // lost at depth; see its comment.

  switch (wait.type) {
    case "loaderHidden": {
      if (!isUsableLocator(wait.locator)) at("locator", "waits for a loader to disappear but names no element to watch");
      // `armLoaderAppearance` passes this straight to `waitFor({ timeout: grace })`.
      if (wait.appearanceGraceMs !== undefined && !isPositiveFinite(wait.appearanceGraceMs)) {
        at("bounds", `has an appearance grace of ${String(wait.appearanceGraceMs)}ms, which is not a positive duration`);
      }
      if (wait.completion !== undefined && !["hidden", "detached", "ariaBusyFalse"].includes(wait.completion)) {
        at("configuration", `names an unknown loader completion signal "${String(wait.completion)}"`);
      }
      // `mustAppear` with no grace window has nothing to wait through: `armLoaderAppearance` is only
      // reached when a grace is configured, so the requirement can never be enforced.
      if (wait.mustAppear === true && wait.appearanceGraceMs === undefined) {
        at("configuration", "requires the loader to appear but sets no appearance grace window, so the requirement is never checked");
      }
      return defects;
    }

    case "elementVisible":
    case "elementHidden":
    case "elementEnabled": {
      // All three call `waitLocator`/`resolveIdentifiedWaitTarget`, which throw without a locator.
      if (!isUsableLocator(wait.locator)) at("locator", "waits on an element but names none");
      return defects;
    }

    case "textVisible": {
      // `getByText("")` matches every element on the page, so an empty string is not a wait at all.
      if (!isNonEmptyString(wait.text)) at("value", "waits for text to appear but names no text; an empty match succeeds against any page");
      return defects;
    }

    case "toastVisible": {
      // Genuinely needs nothing: it falls back to `getByRole("alert")`. Judge only what IS supplied.
      if (wait.locator !== undefined && !isUsableLocator(wait.locator)) at("locator", "supplies an empty toast locator; clear it to fall back to the page's alert role, or complete it");
      if (wait.text !== undefined && !isNonEmptyString(wait.text)) at("value", "supplies empty toast text; clear it to fall back to the page's alert role, or complete it");
      return defects;
    }

    case "response": {
      // `buildResponseWait` matches on method + `urlContains ?? ""`. With neither, the predicate is
      // `true` for the first response of any kind — a wait that proves nothing about the endpoint.
      if (!isNonEmptyString(wait.urlContains) && wait.method === undefined) {
        at("value", "matches no particular response: set a URL fragment or an HTTP method, or it resolves on whatever response arrives first");
      }
      if (wait.statusRange !== undefined && !isUsableStatusRange(wait.statusRange)) {
        at("bounds", `has an unusable status range ${JSON.stringify(wait.statusRange)}; it must be [low, high] HTTP status codes with low <= high`);
      }
      return defects;
    }

    case "tableHasRows": {
      if (!isUsableLocator(wait.tableLocator)) at("locator", "counts table rows but names no table");
      if (wait.rowLocator !== undefined && !isUsableLocator(wait.rowLocator)) at("locator", "supplies an empty row locator; clear it to use the default row selector, or complete it");
      // `(await rows.count()) >= wait.minRows` — `>= undefined` is always false, so the wait can only
      // ever burn its full timeout reporting the row count it did find.
      if (!isPositiveInteger(wait.minRows)) at("bounds", `expects ${String(wait.minRows)} rows; it must be a whole number of at least 1`);
      return defects;
    }

    case "listHasItems": {
      if (!isUsableLocator(wait.listLocator)) at("locator", "counts list items but names no list");
      if (wait.itemLocator !== undefined && !isUsableLocator(wait.itemLocator)) at("locator", "supplies an empty item locator; clear it to use the default item selector, or complete it");
      if (!isPositiveInteger(wait.minItems)) at("bounds", `expects ${String(wait.minItems)} items; it must be a whole number of at least 1`);
      return defects;
    }

    case "urlChanged": {
      // The predicate is `if (urlContains) … if (fromUrl) … return true`. With NEITHER it returns
      // true on the first poll: the wait reports success without the URL having changed at all.
      if (!isNonEmptyString(wait.urlContains) && !isNonEmptyString(wait.fromUrl)) {
        at("value", "names neither a URL fragment to wait for nor a URL to change away from, so it succeeds immediately without the page navigating");
      }
      return defects;
    }

    case "domStable": {
      // `wait.stableForMs ?? 500` — absent is fine; present-and-unusable is not.
      if (wait.stableForMs !== undefined && !isPositiveFinite(wait.stableForMs)) {
        at("bounds", `waits for a stable window of ${String(wait.stableForMs)}ms, which is not a positive duration`);
      }
      return defects;
    }

    case "fixedDelay": {
      // `waitForTimeout(Math.max(0, wait.delayMs))`: an absent delay is `Math.max(0, undefined)` =
      // NaN, and a negative one is clamped to 0 — a delay that does not delay.
      if (!isPositiveFinite(wait.delayMs)) at("bounds", `has a delay of ${String(wait.delayMs)}ms; it must be a positive number of milliseconds`);
      return defects;
    }

    case "anyOf": {
      const branches = wait.conditions;
      if (!Array.isArray(branches) || branches.length === 0) {
        // The runtime already throws "OR-group has no branches" — but only once the browser is open.
        at("configuration", "is an OR-group with no branches; add at least one completion outcome");
        return defects;
      }
      // A one-branch OR-group is legal and executes correctly, so it is not reported.
      branches.forEach((child, index) => {
        const childPath = path === "" ? `conditions[${index}]` : `${path}.conditions[${index}]`;
        defects.push(...waitConditionDefects(child, childPath, depth + 1));
      });
      return defects;
    }

    case "apiPolling": {
      // `urlContains ?? ""` matches any response, which for a POLL means it terminates on the first
      // unrelated response that happens to fall in the terminal range.
      if (!isNonEmptyString(wait.urlContains)) at("value", "polls for a status response but names no URL fragment, so any response can end the poll");
      if (wait.maxAttempts !== undefined && !isPositiveInteger(wait.maxAttempts)) {
        at("bounds", `allows ${String(wait.maxAttempts)} poll attempts; it must be a whole number of at least 1`);
      }
      if (wait.pollingStatus !== undefined && !(Number.isInteger(wait.pollingStatus) && wait.pollingStatus >= 100 && wait.pollingStatus <= 599)) {
        at("configuration", `names an in-progress status of ${String(wait.pollingStatus)}, which is not an HTTP status code`);
      }
      if (wait.terminalStatusRange !== undefined && !isUsableStatusRange(wait.terminalStatusRange)) {
        at("bounds", `has an unusable terminal status range ${JSON.stringify(wait.terminalStatusRange)}; it must be [low, high] HTTP status codes with low <= high`);
      }
      // `byField` requires BOTH, so half the pair silently reverts to status matching — the poll runs,
      // but not the way it is written, which is worse than failing.
      if (isNonEmptyString(wait.responseField) && !(wait.terminalValues?.length)) {
        at("configuration", `reads the response field "${wait.responseField}" but lists no terminal values, so the field is ignored and only the status decides`);
      }
      if (!isNonEmptyString(wait.responseField) && (wait.terminalValues?.length ?? 0) > 0) {
        at("configuration", "lists terminal values but names no response field to read them from, so they are ignored");
      }
      return defects;
    }

    case "streamActivity": {
      if (!["websocket", "sse", "either"].includes(wait.transport)) {
        at("configuration", `names an unknown stream transport "${String(wait.transport)}"`);
      }
      if (wait.event !== undefined && !["open", "message", "close"].includes(wait.event)) {
        at("configuration", `names an unknown stream event "${String(wait.event)}"`);
      }
      if (wait.diagnostics !== undefined && !["auto", "none"].includes(wait.diagnostics)) {
        at("configuration", `names an unknown diagnostics mode "${String(wait.diagnostics)}"`);
      }
      return defects;
    }

    default: {
      // Unreachable while the switch stays exhaustive; `tsc` proves it via the `never` binding.
      const exhaustive: never = wait;
      void exhaustive;
      return defects;
    }
  }
}

/**
 * Whether a malformed condition would actually stop the run.
 *
 * Mirrors `runRequiredOrOptional` EXACTLY — `wait.optional || wait.evidence?.requirement ===
 * "optional"` — including its exclusion of `"advisory"`. The tidier reading ("anything not required
 * is skippable") would under-report: a hand-authored advisory condition with no `optional` flag is
 * treated as required by the runner and really will fail the step.
 */
export function waitConditionBlocks(wait: WaitCondition): boolean {
  return !(wait.optional === true || wait.evidence?.requirement === "optional");
}
