/**
 * Canonical numeric limits for flow validation and execution (Tranche 2 Stage 2b).
 *
 * A deliberate **leaf module** — it imports nothing, so the runner (`FlowExecutor`), the runtime
 * bounds clamp (`FlowValidation.ts`), the validation engine (`FlowValidator`), the test-lab
 * connector catalog and the renderer can all import it without creating a cycle.
 *
 * Owner decision (2026-07-21): **1,000 is the single hard maximum for loop iterations.** Before
 * Stage 2b the product carried two values — the designer gate and `LOOP_CONNECTOR_HARD_CAP` said
 * 1,000 while `FLOW_BOUNDS.maxLoopIterations` clamped at 10,000 — so a bound between the two was
 * rejected by the designer but silently accepted (and clamped differently) everywhere else. Every
 * site now reads this constant; `scripts/verify-validation.mts` asserts the alignment.
 */
export const FLOW_VALIDATION_LIMITS = {
  /**
   * Hard maximum for every loop-iteration bound: loop connectors (`loop.maxIterations`), legacy
   * back-edges (`maxLoopCount`) and node loop config (`iterationCount`/`maxIterations`).
   * Values above this are validation ERRORS, never warnings, and are not silently clamped by
   * validation (the runtime's F-03 clamp remains as a last-resort DoS backstop for flows that
   * bypass every gate).
   */
  maxLoopIterations: 1000,
  /** `FLOW_BOUNDS.maxTimeoutMs` (FlowValidation.ts) — the runtime clamp, not a rejection point. */
  maxTimeoutMs: 600_000,
  /** Above this a timeout is advisory-only: legal, but usually a mistake. */
  warnTimeoutMs: 120_000,
  /** Above this a loop bound is advisory-only: legal, but a long unattended run. */
  warnLoopIterations: 100
} as const;
