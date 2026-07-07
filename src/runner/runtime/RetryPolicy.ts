/**
 * Classified retry decisions with exponential backoff. Honors the step's configured retry
 * count (existing `step.retry` schema — unchanged) but gates every retry on:
 *  1. explicit `step.safety` metadata (authoritative — dangerous/external-commit never retry,
 *     explicit-retryable steps retry even when their name matches a dangerous keyword),
 *  2. node-type defaults + keyword heuristic fallback when no metadata exists,
 *  3. the error class (infra-terminal failures — dead browser/context/page, profile locked,
 *     manual action required, cancelled — are never retried regardless of metadata).
 */
import { classifyError, INFRA_TERMINAL_ERROR_CLASSES, RETRYABLE_ERROR_CLASSES, type ErrorClass } from "./ErrorClassifier";
import { resolveStepSafety, type StepSafetyPolicy } from "./StepSafetyPolicy";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  errorClass: ErrorClass;
  reason: string;
}

export interface RetryPolicyOptions {
  /** Base delay for exponential backoff when the step has no configured delay. */
  initialDelayMs?: number;
  backoffCoefficient?: number;
  maxDelayMs?: number;
}

export class RetryPolicy {
  private readonly initialDelayMs: number;
  private readonly backoffCoefficient: number;
  private readonly maxDelayMs: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? 500;
    this.backoffCoefficient = options.backoffCoefficient ?? 2;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
  }

  decide(input: {
    step: { type: string; name?: string; value?: string; retry?: { count?: number; delayMs?: number }; safety?: StepSafetyPolicy };
    error?: string;
    /** 0-based attempt index that just failed (0 = first try). */
    attempt: number;
  }): RetryDecision {
    const { step, error, attempt } = input;
    const errorClass = classifyError(error, step.type);
    const configuredRetries = step.retry?.count ?? 0;

    if (attempt >= configuredRetries) {
      return { retry: false, delayMs: 0, errorClass, reason: `retries exhausted (${attempt}/${configuredRetries})` };
    }

    // Infra-terminal failures beat everything: the browser/session is gone or a human is needed.
    if (INFRA_TERMINAL_ERROR_CLASSES.has(errorClass)) {
      return { retry: false, delayMs: 0, errorClass, reason: `error class "${errorClass}" is not auto-retryable` };
    }

    // Safety metadata first (explicit → type defaults → keyword fallback → conservative).
    const safety = resolveStepSafety(step);
    if (safety.sideEffectLevel === "dangerousMutation" || safety.sideEffectLevel === "externalCommit") {
      return {
        retry: false,
        delayMs: 0,
        errorClass: "dangerous-side-effect",
        reason: `step "${step.name ?? step.type}" is classified ${safety.sideEffectLevel} (${safety.source}) — automatic retry is blocked; re-run manually after verifying the side effect`
      };
    }
    if (!safety.retryable) {
      return { retry: false, delayMs: 0, errorClass, reason: `step safety (${safety.source}) marks this ${safety.sideEffectLevel} step non-retryable` };
    }
    if (safety.requiresIdempotencyKey && !safety.idempotencyKeyExpression) {
      return { retry: false, delayMs: 0, errorClass, reason: `step requires an idempotency key but none is configured — automatic retry is blocked` };
    }

    // Explicit metadata retries any non-infra failure; implicit classifications additionally
    // require a known-transient error class (today's behavior preserved).
    if (safety.source !== "explicit" && !RETRYABLE_ERROR_CLASSES.has(errorClass)) {
      return { retry: false, delayMs: 0, errorClass, reason: `error class "${errorClass}" is not auto-retryable` };
    }

    const base = step.retry?.delayMs && step.retry.delayMs > 0 ? step.retry.delayMs : this.initialDelayMs;
    const delayMs = Math.min(this.maxDelayMs, Math.round(base * Math.pow(this.backoffCoefficient, attempt)));
    return { retry: true, delayMs, errorClass, reason: `retryable ${errorClass} failure (attempt ${attempt + 1}/${configuredRetries}, safety: ${safety.sideEffectLevel}/${safety.source})` };
  }
}
