import type { LocatorRecoveryStage, LocatorRecoveryTrace } from "../LocatorFactory";

/**
 * L11.H: locator repair and recovery provenance for execution reports.
 *
 * One bounded, versioned record per recovery attempt, derived only from `LocatorRecoveryTrace` (stage
 * names, outcomes, refusal codes, timings, counts and scores) plus the page alias, frame kind and route
 * agreement it was taken on. It never carries DOM, page text, a selector, a URL, a reference, a prompt or
 * a credential: every string in it is one of the fixed codes below.
 *
 * `actedOn` says who chose the element a recovered step acted on: `awkit-proof` (AWKIT's own gate) or,
 * since L12, `awkit-provider-agreement` (AWKIT's best candidate, refused only on score or margin, that the
 * provider independently ranked first; re-proven, pinned and actionability-checked by AWKIT). A provider
 * never acts on its own: its suggestion is `effect: "none"` unless AWKIT's agreement rule accepted it.
 */

export const RECOVERY_PROVENANCE_VERSION = 1;

export type RecoveryProvenanceEventName =
  | "primary-failed"
  | "route-mismatch"
  | "snapshot-recovery-invoked"
  | "awkit-candidate-proven"
  | "snapshot-recovery-refused"
  | "provider-suggestion-generated"
  | "provider-suggestion-rejected"
  | "provider-agreement-proven"
  | "provider-timeout"
  | "provider-unavailable"
  | "provider-skipped"
  | "provider-error"
  | "fallback-used";

export interface RecoveryProvenanceEvent {
  event: RecoveryProvenanceEventName;
  /** `awkit`: AWKIT's own identity proof. `dom-intelligence`: provider evidence, never executed. */
  source: "awkit" | "dom-intelligence";
  stage?: LocatorRecoveryStage["stage"];
  ms?: number;
  candidates?: number;
  score?: number;
  runnerUpScore?: number;
  reason?: string;
  /** Provider events only: a suggestion has no effect on the run. */
  effect?: "none";
  provider?: string;
  providerScore?: number;
  awkitScore?: number;
  /** What the step did next when recovery was unresolved. */
  fallback?: "recorded-locator";
  /** L12.16: on a refused layer, the identity fields that differ in the closest element (`fingerprintChanges` codes). */
  changed?: string[];
}

/** The only shapes a `changed` code may take: a fixed field, or an attribute the fingerprint allowlists. */
const CHANGE_CODE = /^(tag|role|name|text|position|attribute:(id|name|type|placeholder|data-testid|aria-label|data-key|data-id|data-row-key|data-item-key))$/;

/** The step is the log entry's own `stepId` (a uuid-shaped id inside `data` would be masked as a secret). */
export interface LocatorRecoveryProvenance {
  schemaVersion: typeof RECOVERY_PROVENANCE_VERSION;
  engine: LocatorRecoveryTrace["engine"];
  result: LocatorRecoveryTrace["result"];
  /** Present only when recovered: AWKIT's own proof, or AWKIT's best candidate confirmed by provider agreement. */
  actedOn?: "awkit-proof" | "awkit-provider-agreement";
  page: string;
  frame: "main" | "child";
  frameDepth: number;
  route: "match" | "mismatch" | "unbound";
  totalMs: number;
  events: RecoveryProvenanceEvent[];
}

/** Hard bound on events per record (the trace has at most three stages, so this is never reached). */
export const RECOVERY_PROVENANCE_MAX_EVENTS = 12;

const PAGE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ms = (value: number): number => Math.max(0, Math.round(value));
const score = (value: number | undefined): number | undefined => (value === undefined || !Number.isFinite(value) ? undefined : Number(value.toFixed(3)));
const pick = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

export function toRecoveryProvenance(trace: LocatorRecoveryTrace): LocatorRecoveryProvenance {
  const events: RecoveryProvenanceEvent[] = [{ event: "primary-failed", source: "awkit", candidates: trace.candidatesTried }];
  for (const stage of trace.stages) {
    if (stage.reason === "route-mismatch") {
      events.push({ event: "route-mismatch", source: "awkit", ms: ms(stage.ms) });
      continue;
    }
    if (stage.stage !== "provider") {
      // A skipped layer (no blueprint for the page) never scored anything: it is refused, not invoked.
      if (stage.outcome !== "skipped") events.push(pick({ event: "snapshot-recovery-invoked", source: "awkit", stage: stage.stage, candidates: stage.candidates }));
      events.push(
        pick({
          event: stage.outcome === "proven" ? "awkit-candidate-proven" : "snapshot-recovery-refused",
          source: "awkit",
          stage: stage.stage,
          ms: ms(stage.ms),
          candidates: stage.candidates,
          score: score(stage.score),
          runnerUpScore: score(stage.runnerUpScore),
          reason: stage.outcome === "proven" ? undefined : `${stage.outcome}:${stage.reason ?? "none"}`,
          changed: stage.outcome !== "proven" && stage.changed ? stage.changed.filter((code) => CHANGE_CODE.test(code)).slice(0, 12) : undefined
        }) as RecoveryProvenanceEvent
      );
      continue;
    }
    // A fixed code, whatever a provider's status reported.
    const provider = trace.suggestion ? (trace.suggestion.provider === "scrapling" ? "scrapling" : "none") : undefined;
    if (stage.outcome === "suggested" || stage.outcome === "proven" || (stage.outcome === "refused" && trace.suggestion)) {
      const accepted = stage.outcome === "proven" && trace.result === "recovered";
      events.push(pick({ event: "provider-suggestion-generated", source: "dom-intelligence", stage: "provider", effect: accepted ? undefined : "none", provider, ms: ms(stage.ms), candidates: stage.candidates ?? 0 }) as RecoveryProvenanceEvent);
      const best = trace.suggestion?.best;
      // The provider stage only follows two refusals, so its best candidate is never AWKIT's proven winner.
      // It acts only through the L12 agreement rule; otherwise it is recorded as rejected, with AWKIT's reason
      // (a stale or not-actionable agreed element is rejected with that reason).
      if (best) {
        events.push(
          pick({
            event: accepted ? "provider-agreement-proven" : "provider-suggestion-rejected",
            source: "awkit",
            stage: "provider",
            reason: accepted ? undefined : stage.outcome === "suggested" ? best.proof : `${stage.outcome}:${stage.reason ?? best.proof}`,
            providerScore: score(best.providerScore),
            awkitScore: score(best.awkitScore)
          }) as RecoveryProvenanceEvent
        );
      }
      continue;
    }
    // A skip (no reference, protected surface, L12.11 page variant) is provider-skipped with its reason code.
    const event: RecoveryProvenanceEventName =
      stage.reason === "provider-timeout" ? "provider-timeout" : stage.reason === "provider-unavailable" ? "provider-unavailable" : stage.outcome === "skipped" ? "provider-skipped" : "provider-error";
    events.push(pick({ event, source: "dom-intelligence", stage: "provider", effect: "none", provider, ms: ms(stage.ms), reason: stage.reason }) as RecoveryProvenanceEvent);
  }
  if (trace.result === "unresolved") events.push({ event: "fallback-used", source: "awkit", fallback: "recorded-locator" });
  return {
    schemaVersion: RECOVERY_PROVENANCE_VERSION,
    engine: trace.engine,
    result: trace.result,
    ...(trace.result === "recovered"
      ? { actedOn: trace.stages.some((stage) => stage.stage === "provider" && stage.outcome === "proven") ? ("awkit-provider-agreement" as const) : ("awkit-proof" as const) }
      : {}),
    page: PAGE_ALIAS.test(trace.context.page) ? trace.context.page : "[alias]",
    frame: trace.context.frame,
    frameDepth: Math.min(8, Math.max(0, trace.context.frameDepth)),
    route: trace.context.route,
    totalMs: ms(trace.totalMs),
    events: events.slice(0, RECOVERY_PROVENANCE_MAX_EVENTS)
  };
}
