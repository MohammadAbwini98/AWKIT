/**
 * Shared verifier-harness helper (AWKIT-QA-005).
 *
 * The repo-wide `passed / results.length` shape lets an uncaught throw SHRINK the denominator: a
 * run that crashed half-way prints a full-looking `N/N`. A cardinality assertion closes that —
 * the suite must execute EXACTLY the number of checks it declares, or it fails loudly.
 *
 * Adopt incrementally: existing verifiers keep their own counters and call
 * {@link assertCardinality} just before their summary. New verifiers should prefer
 * {@link createTally}, which also carries the NOT-RUN third state the chromium/egress gates need.
 */

/** Fail unless exactly `expected` checks ran (pass + fail). Never passes vacuously. */
export function assertCardinality(passed, failed, expected, label = "cardinality") {
  const ran = passed + failed;
  if (ran !== expected) {
    console.error(
      `  \u2717 ${label}: executed ${ran} checks, expected exactly ${expected}. ` +
        `An uncaught throw likely shrank the run — judge by EXIT CODE, not the tally.`
    );
    return false;
  }
  console.log(`  \u2713 ${label}: executed exactly ${expected} checks`);
  return true;
}

/** Three-state tally for verifiers whose checks can be genuinely skipped (NOT RUN). */
export function createTally() {
  return {
    passed: 0,
    failed: 0,
    notRun: [],
    pass(label) { this.passed += 1; console.log(`  \u2713 ${label}`); },
    fail(label, detail = "") { this.failed += 1; console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`); },
    skip(label, reason) { this.notRun.push(`${label}${reason ? ` (${reason})` : ""}`); console.log(`  ~ NOT RUN: ${label}${reason ? ` — ${reason}` : ""}`); },
    /** Exit-code rule: failures AND unexecuted declared work both fail the suite. */
    shouldExitZero() { return this.failed === 0 && this.notRun.length === 0; }
  };
}
