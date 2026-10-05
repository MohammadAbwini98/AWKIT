// Types for the plain-JS DOM Coverage Lab corpus (mock-site/dom-coverage-corpus.mjs), for the .mts verifier.
export type CoverageExpectation = "recover" | "refuse";
export interface CoverageFixture {
  id: string;
  layer: "existing" | "lab" | "enterprise";
  page: string;
  path?: string;
  /** Oracle selector for the frozen L10.0 page; corpus pages carry `data-testid="oracle-target"` instead. */
  target?: string;
  action: "click" | "fill";
  title: string;
  /** [mutation, expected outcome, why a present target is refused]. */
  cases: Array<[string, CoverageExpectation, string?]>;
}
export interface ChallengePage {
  id: string;
  detect: string;
  read: boolean;
  html: string;
}
/** L12.24: a similar-rows page; `expect` is the loop's row count (all the picked action) or "refuse". */
export interface SimilarRowPage {
  id: string;
  title: string;
  expect: number | "refuse";
  html: () => string;
}
export const SIMILAR_ROW_LAB: SimilarRowPage[];
export const ORACLE_SELECTOR: string;
export const COVERAGE_FIXTURES: CoverageFixture[];
export const CHALLENGE_PAGES: ChallengePage[];
export const COVERAGE_RUNTIME: string;
export function coveragePage(key: string): string | undefined;
export function coverageIndexPage(): string;
