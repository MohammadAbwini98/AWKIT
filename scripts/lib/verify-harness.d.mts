/**
 * Types for the shared verifier-harness helper (AWKIT-QA-005).
 *
 * `verify-harness.mjs` stays plain `.mjs` because plain-`node` verifiers import it too and cannot
 * load TypeScript. This declaration exists so the `.mts` verifiers that `await import(...)` it are
 * type-checked against a real contract instead of `any` — without that, `assertCardinality` was an
 * implicit `any` (TS7016) and a wrong argument order would have compiled silently, in the one helper
 * whose entire job is to prove a shortened run cannot print a full-looking tally.
 *
 * Same pattern, same reason as `release-key-custody.d.mts`.
 */

/**
 * Fail unless exactly `expected` checks ran (`passed + failed`). Returns `false` — and prints why —
 * when the executed count differs, so the caller can set a non-zero exit code. Never passes vacuously.
 */
export function assertCardinality(
  passed: number,
  failed: number,
  expected: number,
  label?: string
): boolean;

/** Three-state tally for verifiers whose checks can be genuinely skipped (NOT RUN). */
export interface VerifierTally {
  passed: number;
  failed: number;
  notRun: string[];
  pass(label: string): void;
  fail(label: string, detail?: string): void;
  skip(label: string, reason?: string): void;
  /** Exit-code rule: failures AND unexecuted declared work both fail the suite. */
  shouldExitZero(): boolean;
}

export function createTally(): VerifierTally;
