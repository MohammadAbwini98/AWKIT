/**
 * Canonical source for the Randomized Test Lab packaging decision (bd `awkit-wza.8`).
 *
 * Owner decision 2026-07-29: the Test Lab stays **CLI-only by architectural decision**. The
 * generation, mutation, orchestration, and result-classification layers live under developer/test
 * tooling and are never compiled into the shipped application. Phase 7 is therefore CLOSED as a
 * recorded architecture decision, not left open as an unbuilt product feature.
 *
 * This module is the single place that names what "CLI-only" means mechanically, so
 * `verify:test-lab-cli-only` and the documentation can never drift from each other. Nothing here is
 * bundled into the app — `scripts/` is tooling.
 */

/** The owner's decision sentence. Documentation must quote this verbatim. */
export const TEST_LAB_PACKAGING_DECISION =
  "The Randomized Test Lab is CLI-only by architectural decision; its generation harness is never " +
  "shipped inside the production application.";

/**
 * Directory roots that hold the Test Lab harness. Nothing under `app/` may import from these, and
 * nothing built from them may appear in a production bundle.
 */
export const TEST_LAB_SOURCE_ROOTS = ["src/testing/"] as const;

/**
 * Harness symbols that would only appear in a bundle if the lab had been wired into the app. These
 * are deliberately exported identifiers rather than substrings of common words, so a match is real
 * evidence rather than a coincidence.
 *
 * Capture permissively / validate strictly: this list is checked against the built artifacts, and a
 * cardinality assertion in the verifier proves the list itself was non-empty and actually resolved
 * to real exports in the repository — a scan for symbols that do not exist would pass vacuously.
 */
export const TEST_LAB_HARNESS_SYMBOLS = [
  "RandomTestRunner",
  "CampaignReportWriter",
  "FailureArtifactWriter",
  "CoverageTracker",
  "generateLifecycleCampaign",
  "KNOWN_ROUNDTRIP_DEFECTS"
] as const;

/** Production bundles that must contain none of the above. Paths are repo-relative. */
export const PRODUCTION_BUNDLE_GLOBS = [
  "out/main/main.js",
  "out/preload/preload.mjs",
  "out/renderer/assets"
] as const;

/**
 * Route-registration files. A Test Lab page would have to touch all four (RouteId union, AppRoute
 * entry, RoutePermissions, LeftNavigation group), so asserting the absence of a lab route id across
 * them is what makes "no production UI surface" checkable rather than asserted.
 */
export const ROUTE_REGISTRATION_FILES = [
  "app/renderer/routes.tsx",
  "app/renderer/security/routePermissions.ts",
  "app/renderer/layout/LeftNavigation.tsx"
] as const;

/** Route identifiers that would indicate a shipped Test Lab surface. */
export const FORBIDDEN_ROUTE_TOKENS = ["testLab", "test-lab", "TestLab"] as const;

export interface TestLabPackagingViolation {
  readonly kind: "source-import" | "bundle-symbol" | "route-token";
  readonly location: string;
  readonly detail: string;
}

/**
 * Pure evaluator. Given what was read from disk, decide whether the CLI-only boundary still holds.
 * Kept pure so the verifier can also drive it with synthetic violating input — a guard that has
 * never been shown to fail is not a guard.
 */
export function evaluateTestLabPackaging(input: {
  /** `app/**` files that import a Test Lab root, as [file, importedPath] pairs. */
  readonly appImports: ReadonlyArray<readonly [string, string]>;
  /** Harness symbols found in each production bundle, as [bundle, symbol] pairs. */
  readonly bundleSymbols: ReadonlyArray<readonly [string, string]>;
  /** Forbidden route tokens found in registration files, as [file, token] pairs. */
  readonly routeTokens: ReadonlyArray<readonly [string, string]>;
}): { readonly ok: boolean; readonly violations: readonly TestLabPackagingViolation[] } {
  const violations: TestLabPackagingViolation[] = [
    ...input.appImports.map(
      ([file, imported]): TestLabPackagingViolation => ({
        kind: "source-import",
        location: file,
        detail: `imports the Test Lab harness (${imported})`
      })
    ),
    ...input.bundleSymbols.map(
      ([bundle, symbol]): TestLabPackagingViolation => ({
        kind: "bundle-symbol",
        location: bundle,
        detail: `production bundle contains the harness symbol ${symbol}`
      })
    ),
    ...input.routeTokens.map(
      ([file, token]): TestLabPackagingViolation => ({
        kind: "route-token",
        location: file,
        detail: `registers a Test Lab route surface (${token})`
      })
    )
  ];
  return { ok: violations.length === 0, violations };
}
