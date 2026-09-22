/**
 * Deterministic failure-cause baseline (Phase L, L5a): a coded precedence table over run-lifetime
 * evidence. Always computed for a failed run, never uses a model, and never changes a run's status,
 * retries or policy. Later AI analysis (L5b) may auto-run only where it beats this baseline on the
 * labelled set (docs/ai/DECISIONS.md, decision 7).
 *
 * Precedence:
 *  1. A cancelled run is `cancelled`.
 *  2. Direct evidence in the failing step's window wins, earliest first: an error document, a
 *     transport failure, an HTTP error, an uncaught script error, a field that failed validation, a
 *     UI error message. The earliest is usually the root cause; later ones are its consequences.
 *     Runtime request provenance refines this, and only where the runner observed it: the failed
 *     step's own request (its response wait matched it, or its navigation returned it) comes before
 *     every other request event that preceded it, and a request issued after the failure is never a
 *     cause. The link says which request the step depended on, not that it caused the failure, so it
 *     never moves ahead of earlier evidence the provenance does not describe (a script error, a UI
 *     message). Without provenance, as in every report written before 2026-09-22, nothing changes.
 *  3. Otherwise the same classes in a bounded window before the step.
 *  4. Otherwise the runner's own failure (timeout, assertion, locator, navigation), citing its own
 *     event first and, as context, the step's console errors (else those just before the step).
 *  5. Otherwise a `console.error` in the step window.
 *  6. Otherwise `insufficient`.
 * Neutral UI (`ui.status`, info toasts) is never a cause, and a console error never outranks the
 * runner's own diagnosis.
 *
 * Framework-agnostic and pure.
 */

import { requestRelations, type EvidenceSource, type ExecutionEvidenceEvent, type RequestRelation } from "./ExecutionEvidence";

export const FAILURE_CAUSE_SCHEMA_VERSION = 1;

export type FailureCauseCode =
  | "errorPage"
  | "transportFailure"
  | "httpError"
  | "scriptError"
  | "uiValidation"
  | "uiErrorMessage"
  | "timeout"
  | "assertionFailed"
  | "locatorNotFound"
  | "navigationFailed"
  | "consoleError"
  | "cancelled"
  | "insufficient";

export type RunnerFailureKind = "timeout" | "assertion" | "locator" | "navigation" | "cancelled" | "other";

export interface RunnerFailure {
  kind: RunnerFailureKind;
  /** Offset (evidence clock) at which the failing step started, when known. */
  stepStartOffsetMs?: number;
  /** Offset at which the run failed. */
  failedAtOffsetMs: number;
  /** Id of the `runner.failure` evidence event, when one was recorded. */
  evidenceId?: string;
}

export interface FailureCauseBaseline {
  schemaVersion: typeof FAILURE_CAUSE_SCHEMA_VERSION;
  cause: FailureCauseCode;
  /** The event the cause rests on first, then supporting events. Empty for `insufficient`. */
  evidenceIds: string[];
  /** Which window the cause came from. */
  window: "failingStep" | "preceding" | "none";
  /** Product-authored explanation. Never page text. */
  reason: string;
}

export const CAUSE_WINDOW_LIMITS = Object.freeze({
  /** Step window when the step start is unknown: this long before the failure. */
  defaultStepWindowMs: 30_000,
  /** Evidence arriving just after the failure still belongs to it (a response lands late). */
  graceAfterFailureMs: 500,
  /** The bounded preceding window. */
  precedingWindowMs: 10_000,
  /** Supporting evidence ids kept after the primary. */
  maxSupporting: 4
});

/** Direct evidence classes, in tie-break order for events at the same instant. */
const DIRECT: ReadonlyArray<{ source: EvidenceSource; cause: FailureCauseCode; reason: string }> = [
  { source: "page.errorDocument", cause: "errorPage", reason: "The page navigated to an error document." },
  { source: "network.failed", cause: "transportFailure", reason: "A request failed before any response arrived." },
  { source: "http.error", cause: "httpError", reason: "The server answered a request with an error status." },
  { source: "page.error", cause: "scriptError", reason: "The page threw an uncaught script error." },
  { source: "ui.fieldInvalid", cause: "uiValidation", reason: "A form field failed validation." },
  { source: "ui.alert", cause: "uiErrorMessage", reason: "The page showed an error message." },
  { source: "ui.toast", cause: "uiErrorMessage", reason: "The page showed an error message." }
];
const DIRECT_RANK = new Map(DIRECT.map((entry, index) => [entry.source, index]));

/** Causes resting on direct evidence (precedence 2–3), rather than on the runner's own diagnosis or a console error. */
export const DIRECT_FAILURE_CAUSES: ReadonlySet<FailureCauseCode> = new Set(DIRECT.map((entry) => entry.cause));

const RUNNER_CAUSE: Record<Exclude<RunnerFailureKind, "cancelled" | "other">, { cause: FailureCauseCode; reason: string }> = {
  timeout: { cause: "timeout", reason: "The step timed out with no direct error captured." },
  assertion: { cause: "assertionFailed", reason: "An assertion did not match." },
  locator: { cause: "locatorNotFound", reason: "The step's target element was not found." },
  navigation: { cause: "navigationFailed", reason: "A navigation failed." }
};

/** UI sources count as direct evidence only when classified as errors. */
function isDirect(event: ExecutionEvidenceEvent): boolean {
  if (!DIRECT_RANK.has(event.source)) return false;
  return event.source.startsWith("ui.") && event.source !== "ui.fieldInvalid" ? event.severity === "error" : true;
}

function byTimeThenRank(a: ExecutionEvidenceEvent, b: ExecutionEvidenceEvent): number {
  return a.offsetMs - b.offsetMs || (DIRECT_RANK.get(a.source) ?? 99) - (DIRECT_RANK.get(b.source) ?? 99) || a.id.localeCompare(b.id);
}

/**
 * Time-ordered direct evidence, with the failed step's own request moved ahead of the other request events
 * before it (background, off-target, earlier-issued, another step's, or of unknown relation): they follow
 * it, in their own order. Evidence without provenance keeps its place, so the link never outranks it.
 */
function ownRequestFirst(direct: ExecutionEvidenceEvent[], relations: ReadonlyMap<string, RequestRelation>): ExecutionEvidenceEvent[] {
  const own = direct.findIndex((event) => relations.get(event.id) === "linkedToFailedStep");
  if (own <= 0) return direct;
  const displaced = direct.slice(0, own).filter((event) => relations.has(event.id));
  const kept = direct.filter((event) => !displaced.includes(event));
  const after = kept.indexOf(direct[own]) + 1;
  return [...kept.slice(0, after), ...displaced, ...kept.slice(after)];
}

export function deriveFailureCause(events: readonly ExecutionEvidenceEvent[], failure: RunnerFailure): FailureCauseBaseline {
  const limits = CAUSE_WINDOW_LIMITS;
  const withRunner = (ids: string[]) => (failure.evidenceId && !ids.includes(failure.evidenceId) ? [...ids, failure.evidenceId] : ids);
  const result = (cause: FailureCauseCode, ids: string[], window: FailureCauseBaseline["window"], reason: string): FailureCauseBaseline => ({
    schemaVersion: FAILURE_CAUSE_SCHEMA_VERSION,
    cause,
    evidenceIds: ids,
    window,
    reason
  });

  if (failure.kind === "cancelled") return result("cancelled", withRunner([]), "none", "The run was cancelled.");

  const stepStart = failure.stepStartOffsetMs ?? Math.max(0, failure.failedAtOffsetMs - limits.defaultStepWindowMs);
  const stepEnd = failure.failedAtOffsetMs + limits.graceAfterFailureMs;
  const inStep = (event: ExecutionEvidenceEvent) => event.offsetMs >= stepStart && event.offsetMs <= stepEnd;
  const inPreceding = (event: ExecutionEvidenceEvent) => event.offsetMs >= stepStart - limits.precedingWindowMs && event.offsetMs < stepStart;
  // Against the runner record this failure names, as the failure-analysis request reads it.
  const relations = requestRelations(events, events.find((event) => event.id === failure.evidenceId));

  for (const [window, within] of [
    ["failingStep", inStep],
    ["preceding", inPreceding]
  ] as const) {
    const candidates = events.filter((event) => within(event) && isDirect(event) && relations.get(event.id) !== "issuedAfterFailure").sort(byTimeThenRank);
    const direct = ownRequestFirst(candidates, relations);
    const primary = direct[0];
    if (!primary) continue;
    const entry = DIRECT.find((candidate) => candidate.source === primary.source) as (typeof DIRECT)[number];
    const supporting = direct.slice(1, 1 + limits.maxSupporting).map((event) => event.id);
    return result(entry.cause, withRunner([primary.id, ...supporting]), window, entry.reason);
  }

  const consoleIn = (within: (event: ExecutionEvidenceEvent) => boolean) =>
    events.filter((event) => within(event) && event.source === "console.error").sort(byTimeThenRank);
  const consoleErrors = consoleIn(inStep);
  if (failure.kind !== "other") {
    const runner = RUNNER_CAUSE[failure.kind];
    // The cause rests on the runner's own failure. Console errors never outrank it but are its
    // nearest context: the step's own, else those in the bounded window before it.
    const context = (consoleErrors.length > 0 ? consoleErrors : consoleIn(inPreceding)).slice(0, limits.maxSupporting).map((event) => event.id);
    return result(runner.cause, failure.evidenceId ? [failure.evidenceId, ...context] : context, "failingStep", runner.reason);
  }
  if (consoleErrors[0]) {
    return result(
      "consoleError",
      withRunner(consoleErrors.slice(0, 1 + limits.maxSupporting).map((event) => event.id)),
      "failingStep",
      "The page logged an error; nothing more direct was captured."
    );
  }
  return result("insufficient", [], "none", "No evidence explains the failure.");
}
