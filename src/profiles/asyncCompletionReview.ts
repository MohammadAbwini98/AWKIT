import type { AsyncCompletionMode, WaitCondition } from "./FlowProfile";

/**
 * Async completion review + classification (awkit-54t).
 *
 * A pure, browser-free analysis of a step/action's condition-based waits (`beforeWaits`/`afterWaits`)
 * and completion policy, shared by the Flow Designer Async Completion editor and the Recorder
 * review-before-save summary. It never executes anything — it statically classifies how trustworthy
 * the configured async completion is and surfaces contradiction warnings, so unsafe/incomplete
 * conditions are never silently presented as reliable.
 */

/** How trustworthy a step's async completion configuration is. Ordered worst-last for `maxClass`. */
export type AsyncActivityClass = "reliable" | "needsReview" | "incomplete" | "unsafe";

const SEVERITY: Record<AsyncActivityClass, number> = { reliable: 0, needsReview: 1, incomplete: 2, unsafe: 3 };

/** The most severe of two classifications. */
export function maxClass(a: AsyncActivityClass, b: AsyncActivityClass): AsyncActivityClass {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export interface WaitReview {
  classification: AsyncActivityClass;
  warnings: string[];
}

/** Structural input satisfied by both `FlowStep` and the recorder's `RecordedAction`. */
export interface AsyncReviewInput {
  id: string;
  name: string;
  beforeWaits?: WaitCondition[];
  afterWaits?: WaitCondition[];
  completionMode?: AsyncCompletionMode;
}

export interface StepAsyncReview {
  id: string;
  name: string;
  completionMode: AsyncCompletionMode;
  classification: AsyncActivityClass;
  /** Policy-level warnings (not tied to a single wait). */
  warnings: string[];
  waits: Array<{ phase: "beforeWaits" | "afterWaits"; index: number; wait: WaitCondition } & WaitReview>;
}

/** A `fixedDelay` is a timing fallback, never a concrete "the work finished" signal. */
function isCompletionSignal(wait: WaitCondition): boolean {
  return wait.type !== "fixedDelay";
}

/** Heuristic: a CSS locator with no id/attribute/class specificity is likely non-unique. */
function looksNonUnique(strategy: string, value: string): boolean {
  if (strategy !== "css") return false;
  const v = value.trim();
  if (!v) return false;
  if (v === "*") return true;
  // A bare tag name ("div", "span") or comma-separated bare tags — no ., #, [] specificity.
  return /^[a-z][a-z0-9]*(\s*,\s*[a-z][a-z0-9]*)*$/i.test(v);
}

const EMPTY_STATE_TEXT = /\b(no results|no data|no records|empty|nothing found|0 results)\b/i;

/** Classify a single wait condition in isolation. */
export function reviewWait(wait: WaitCondition): WaitReview {
  const warnings: string[] = [];
  let classification: AsyncActivityClass = "reliable";
  const worsen = (c: AsyncActivityClass, message: string) => {
    classification = maxClass(classification, c);
    warnings.push(message);
  };

  switch (wait.type) {
    case "response":
      if (!wait.method && !wait.urlContains) {
        worsen("unsafe", "API condition has no endpoint pattern (method or URL) — it can match unrelated requests.");
      }
      if (wait.statusRange) {
        const [lo, hi] = wait.statusRange;
        if (lo > hi) worsen("unsafe", `Expected status range is inverted (${lo}–${hi}).`);
        else if (lo === 200 && hi === 200) worsen("needsReview", "Only HTTP 200 is accepted — 201/204 successes would be treated as errors.");
      }
      break;
    case "loaderHidden":
    case "elementVisible":
    case "elementHidden":
    case "elementEnabled": {
      const { strategy, value } = wait.locator ?? { strategy: "", value: "" };
      if (!value) worsen("incomplete", "Locator is empty — this condition cannot resolve a target.");
      else if (looksNonUnique(strategy, value)) worsen("needsReview", `Locator "${value}" may match multiple elements (non-unique).`);
      if (wait.type === "loaderHidden" && wait.mustAppear && !value) {
        worsen("unsafe", "Loader is required to appear but has no locator.");
      }
      break;
    }
    case "textVisible":
      if (!wait.text?.trim()) worsen("incomplete", "Text outcome has no text to match.");
      break;
    case "toastVisible":
      // A toast with neither locator nor text falls back to [role=alert] — acceptable but broad.
      if (!wait.locator && !wait.text) worsen("needsReview", "Toast outcome matches any [role=alert] — consider naming the text.");
      break;
    case "tableHasRows":
      if (!wait.tableLocator?.value) worsen("incomplete", "Table outcome has no table locator.");
      break;
    case "listHasItems":
      if (!wait.listLocator?.value) worsen("incomplete", "List outcome has no list locator.");
      break;
    case "urlChanged":
      if (!wait.urlContains && !wait.fromUrl) worsen("needsReview", "URL-change outcome matches any change — consider a URL fragment.");
      break;
    case "fixedDelay":
      worsen("needsReview", "Fixed delay is a timing guess, not a real completion signal.");
      break;
    case "domStable":
      break;
    case "apiPolling":
      if (!wait.urlContains) worsen("unsafe", "Polling condition has no URL pattern — it can match unrelated responses.");
      if (wait.responseField && !(wait.terminalValues && wait.terminalValues.length)) {
        worsen("needsReview", "A response field is set but no terminal values — the poll cannot recognize completion.");
      }
      break;
    case "anyOf": {
      // OR-group (awkit-y24): the group is as trustworthy as its WORST branch. A group of alternatives
      // (e.g. "table has rows" OR "empty-state visible") is NOT a contradiction — that is its purpose.
      const children = wait.conditions ?? [];
      if (children.length === 0) worsen("incomplete", "OR-group has no conditions.");
      else if (children.length === 1) worsen("needsReview", "OR-group has a single branch — the group adds nothing.");
      for (const child of children) {
        const childReview = reviewWait(child);
        classification = maxClass(classification, childReview.classification);
        warnings.push(...childReview.warnings);
      }
      break;
    }
  }

  if (wait.optional && SEVERITY[classification] >= SEVERITY.unsafe) {
    // An optional condition can't fail the step, so an unsafe optional is only "needs review".
    classification = "needsReview";
  }
  return { classification, warnings };
}

/**
 * Review a step/action's whole async completion (its waits + policy). Returns `null` when there are
 * no condition-based waits (nothing to review). `afterWaits` drive completion; `beforeWaits` are
 * pre-conditions.
 */
export function reviewStepAsync(input: AsyncReviewInput): StepAsyncReview | null {
  const before = input.beforeWaits ?? [];
  const after = input.afterWaits ?? [];
  if (before.length === 0 && after.length === 0) return null;

  const mode: AsyncCompletionMode = input.completionMode ?? "allRequired";
  const waits: StepAsyncReview["waits"] = [];
  let classification: AsyncActivityClass = "reliable";

  const push = (phase: "beforeWaits" | "afterWaits", list: WaitCondition[]) => {
    list.forEach((wait, index) => {
      const review = reviewWait(wait);
      classification = maxClass(classification, review.classification);
      waits.push({ phase, index, wait, ...review });
    });
  };
  push("beforeWaits", before);
  push("afterWaits", after);

  // ── Policy-level checks ────────────────────────────────────────────────────
  const warnings: string[] = [];
  const requiredSignals = after.filter((w) => !w.optional && isCompletionSignal(w));
  if (after.length > 0 && requiredSignals.length === 0) {
    classification = maxClass(classification, "incomplete");
    warnings.push("No required completion signal after the action — nothing concrete gates completion.");
  }
  if (mode === "networkThenUi" && !after.some((w) => w.type === "response")) {
    classification = maxClass(classification, "needsReview");
    warnings.push("Policy is 'Network then UI' but there is no API condition.");
  }
  if (mode === "anyRequired" && requiredSignals.length < 2) {
    classification = maxClass(classification, "needsReview");
    warnings.push("Policy is 'Any required' but there are fewer than two required conditions to choose between.");
  }
  // Contradiction: a required non-empty table alongside an empty-state text outcome.
  const requiresRows = after.some((w) => w.type === "tableHasRows" && !w.optional && w.minRows >= 1);
  const hasEmptyState = after.some((w) => w.type === "textVisible" && EMPTY_STATE_TEXT.test(w.text ?? ""));
  if (requiresRows && hasEmptyState) {
    classification = maxClass(classification, "unsafe");
    warnings.push("A required 'table has rows' condition conflicts with an empty-result outcome on the same step.");
  }

  return { id: input.id, name: input.name, completionMode: mode, classification, warnings, waits };
}

/** Human label + short guidance for a classification (for badges/tooltips). */
export function classLabel(c: AsyncActivityClass): { label: string; hint: string } {
  switch (c) {
    case "reliable":
      return { label: "Reliable", hint: "The completion conditions look concrete and consistent." };
    case "needsReview":
      return { label: "Needs review", hint: "Usable, but a condition is broad or ambiguous — confirm it." };
    case "incomplete":
      return { label: "Incomplete", hint: "A condition is missing essential information and won't resolve." };
    case "unsafe":
      return { label: "Unsafe", hint: "The conditions are contradictory or too broad to trust." };
  }
}

/** Roll a set of reviews into overall counts + worst class (for the Recorder review header). */
export function summarizeReviews(reviews: StepAsyncReview[]): {
  total: number;
  counts: Record<AsyncActivityClass, number>;
  worst: AsyncActivityClass;
} {
  const counts: Record<AsyncActivityClass, number> = { reliable: 0, needsReview: 0, incomplete: 0, unsafe: 0 };
  let worst: AsyncActivityClass = "reliable";
  for (const r of reviews) {
    counts[r.classification] += 1;
    worst = maxClass(worst, r.classification);
  }
  return { total: reviews.length, counts, worst };
}
