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
/** L12.25: `hidden` look-alikes in hidden tabs, inside the editor container or outside it; `control` expects recovery. */
export interface TwinPoolPage {
  id: string;
  hidden: number;
  where: "inside" | "outside";
  control?: boolean;
}
export const TWIN_POOL_LAB: TwinPoolPage[];
/** L12.27: look-alikes introduced between passing resolves (`passes`), then `final`; see the corpus for the ops. */
export interface TwinLatePage {
  id: string;
  title: string;
  passes: string[][];
  /** Ops applied before a resolve that must recover the original node (after the passes). */
  recovery?: string[];
  final: string[];
  remembered: number;
  expect: "refuse" | "recover";
}
export const TWIN_LATE_LAB: TwinLatePage[];
/** L12.30: a look-alike remembered, then a pass that overflows or truncates the history; `reason` is the required refusal. */
export interface TwinHistoryPage {
  id: string;
  title: string;
  passes: string[][];
  final: string[];
  remembered: number | undefined;
  reason: "twins-unproven" | "pre-existing-twin";
}
export const TWIN_HISTORY_LAB: TwinHistoryPage[];
export const ORACLE_SELECTOR: string;
export const COVERAGE_FIXTURES: CoverageFixture[];
export const CHALLENGE_PAGES: ChallengePage[];
export const COVERAGE_RUNTIME: string;
export function coveragePage(key: string): string | undefined;
export function coverageIndexPage(): string;
