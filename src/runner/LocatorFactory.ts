import type { Page, Locator } from "playwright";
import type { FlowStep, LocatorCandidate, LocatorContext } from "@src/profiles/FlowProfile";

/**
 * Anything Playwright can build sub-locators from: a `Page`, a `FrameLocator`, or a `Locator`.
 * All three expose the same `getBy*` / `locator()` builder surface, which lets us resolve a
 * candidate against a scoped container (dialog/row/card/iframe) exactly like against the page.
 */
interface LocatorRoot {
  locator(selector: string): Locator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByRole(role: any, options?: { name?: string; exact?: boolean }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  getByLabel(text: string, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string): Locator;
}

/** Per-candidate resolution result, collected for diagnostics when nothing resolves uniquely. */
interface CandidateDiagnostic {
  strategy: string;
  value: string;
  count: number;
  visibleCount: number;
}

/** How many matches to probe for visibility before giving up (bounds pathological pages). */
const VISIBILITY_PROBE_CAP = 30;

export class LocatorFactory {
  constructor(private page: Page) {}

  /** Redirect locator creation to a different page (used by Route Change). */
  setPage(page: Page): void {
    this.page = page;
  }

  /**
   * Build a single Playwright locator from a candidate, rooted at the page (no fallback,
   * no visibility disambiguation). Used where multiple/absent matches are expected —
   * `count` assertions, element loops, and `waitFor`.
   */
  create(locator: FlowStep["locator"]): Locator {
    if (!locator) {
      throw new Error("Locator is required for this step.");
    }
    return this.buildOn(this.page, locator);
  }

  /**
   * Resolve a step's locator to a *single* element for an action, with fallback support:
   *  1. Apply container/frame context so candidates resolve inside the right subtree.
   *  2. Try the primary, then `alternatives` in order.
   *  3. For each: a unique match wins; otherwise, if exactly one match is visible, use it
   *     (this is what disambiguates a hidden modal template from the visible modal).
   *  4. If nothing is present yet (all counts 0), return the primary so the caller's action
   *     auto-waits — preserving legacy behavior for elements that appear after a delay.
   *  5. If something is present but genuinely ambiguous, throw a clear diagnostic.
   */
  async resolve(step: FlowStep): Promise<Locator> {
    const spec = step.locator;
    if (!spec) {
      throw new Error("Locator is required for this step.");
    }

    const root = await this.buildRoot(spec.context);
    const candidates: LocatorCandidate[] = [
      { strategy: spec.strategy, value: spec.value, name: spec.name, exact: spec.exact },
      ...(spec.alternatives ?? [])
    ];

    const diagnostics: CandidateDiagnostic[] = [];
    let ambiguousPresent = false;
    let primaryLocator: Locator | null = null;

    for (const candidate of candidates) {
      let locator: Locator;
      try {
        locator = this.buildOn(root, candidate);
      } catch {
        continue; // unsupported/broken candidate — skip to the next fallback
      }
      if (!primaryLocator) primaryLocator = locator;

      const single = await LocatorFactory.pickSingle(locator, candidate, diagnostics);
      if (single) return single;

      const last = diagnostics[diagnostics.length - 1];
      if (last && last.count > 1) ambiguousPresent = true;
    }

    // Nothing matched anything yet: hand back the primary so the action auto-waits (legacy path).
    if (!ambiguousPresent && primaryLocator) return primaryLocator;

    throw new Error(LocatorFactory.formatFailure(step, diagnostics));
  }

  /** Build a scoped root from container/frame context, resolving the container to one element. */
  private async buildRoot(context?: LocatorContext): Promise<LocatorRoot> {
    let root: LocatorRoot = this.page;

    if (context?.frame?.selector) {
      root = this.page.frameLocator(context.frame.selector) as unknown as LocatorRoot;
    }

    const container = context?.container;
    if (container) {
      let containerLocator = this.buildOn(root, container);
      if (container.hasText) containerLocator = containerLocator.filter({ hasText: container.hasText });
      const single = await LocatorFactory.pickSingle(containerLocator, container, []);
      root = (single ?? containerLocator.first()) as unknown as LocatorRoot;
    }

    return root;
  }

  /** Build one Playwright locator for `candidate` against an arbitrary root. */
  private buildOn(root: LocatorRoot, candidate: LocatorCandidate): Locator {
    switch (candidate.strategy) {
      case "id":
        return root.locator(`#${candidate.value}`);
      case "css":
      case "tagName":
        return root.locator(candidate.value);
      case "xpath":
        return root.locator(`xpath=${candidate.value}`);
      case "text":
        return root.getByText(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "label":
        return root.getByLabel(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "placeholder":
        return root.getByPlaceholder(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "testId":
        return root.getByTestId(candidate.value);
      case "role":
        return root.getByRole(
          candidate.value,
          candidate.name ? { name: candidate.name, exact: candidate.exact ?? false } : undefined
        );
      default:
        throw new Error(`Unsupported locator strategy: ${(candidate as LocatorCandidate).strategy}`);
    }
  }

  /**
   * Return `locator` if it resolves to exactly one element, or the single *actionable* match when
   * several exist; otherwise `null`. Always records a diagnostic entry. Playwright 1.49 has no
   * `filter({ visible })`, so visibility is probed per-index via `nth(i).isVisible()`.
   *
   * Self-healing (safe by design): when several matches are visible, narrow by deterministic,
   * intent-free actionability — a single *enabled* match wins, else a single *in-viewport* match
   * wins. If two or more remain equally actionable we return `null` (never guess the wrong twin);
   * the caller then fails with a clear diagnostic. This only converts would-be failures into
   * successes — it never changes which element an already-unambiguous step resolves to.
   */
  private static async pickSingle(
    locator: Locator,
    meta: LocatorCandidate,
    diagnostics: CandidateDiagnostic[]
  ): Promise<Locator | null> {
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      count = 0;
    }

    if (count === 1) {
      diagnostics.push({ strategy: meta.strategy, value: meta.value, count: 1, visibleCount: 1 });
      return locator;
    }

    const visibleIndices: number[] = [];
    if (count > 1) {
      const cap = Math.min(count, VISIBILITY_PROBE_CAP);
      for (let i = 0; i < cap; i += 1) {
        let visible = false;
        try {
          visible = await locator.nth(i).isVisible();
        } catch {
          visible = false;
        }
        if (visible) visibleIndices.push(i);
      }
    }

    diagnostics.push({ strategy: meta.strategy, value: meta.value, count, visibleCount: visibleIndices.length });
    if (visibleIndices.length === 1) return locator.nth(visibleIndices[0]);

    if (visibleIndices.length > 1) {
      const actionable = await LocatorFactory.narrowToActionable(locator, visibleIndices);
      if (actionable >= 0) return locator.nth(actionable);
    }
    return null;
  }

  /**
   * Among the given (visible) indices, return the index of the single actionable element, or -1
   * when zero or multiple remain. Prefers a single *enabled* match, then a single *in-viewport*
   * match — both deterministic and intent-free, so we never pick the wrong one of two equal twins.
   */
  private static async narrowToActionable(locator: Locator, indices: number[]): Promise<number> {
    const enabled: number[] = [];
    for (const i of indices) {
      let ok = true;
      try {
        ok = await locator.nth(i).isEnabled();
      } catch {
        ok = true; // non-disableable elements are "enabled"
      }
      if (ok) enabled.push(i);
    }
    if (enabled.length === 1) return enabled[0];

    const pool = enabled.length > 1 ? enabled : indices;
    const inView: number[] = [];
    for (const i of pool) {
      let visible = false;
      try {
        visible = await locator.nth(i).evaluate((el) => {
          const r = (el as Element).getBoundingClientRect();
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        });
      } catch {
        visible = false;
      }
      if (visible) inView.push(i);
    }
    if (inView.length === 1) return inView[0];

    return -1; // still ambiguous — do not guess
  }

  /** Build an actionable, end-user-readable diagnostic when no candidate resolved uniquely. */
  private static formatFailure(step: FlowStep, diagnostics: CandidateDiagnostic[]): string {
    const spec = step.locator;
    const quality = spec?.quality;
    const head =
      quality && quality.isUnique === false
        ? `This step cannot continue because the saved locator matches ${quality.matchCount} elements.`
        : `This step could not run because its locator matched multiple elements on the page.`;

    const tried = diagnostics.length
      ? diagnostics
          .map((d) => `  • ${d.strategy}=${d.value} → ${d.count} match(es), ${d.visibleCount} visible`)
          .join("\n")
      : "  • (no candidates matched any element)";

    const scope: string[] = [];
    if (spec?.context?.container) {
      const c = spec.context.container;
      scope.push(`container: ${c.type} (${c.strategy}=${c.value})`);
    }
    if (spec?.context?.frame) scope.push(`frame: ${spec.context.frame.selector}`);
    const scopeLine = scope.length ? `\nContext: ${scope.join("; ")}` : "";

    return [
      head,
      `Step: ${step.name} (${step.type})`,
      `Tried:\n${tried}${scopeLine}`,
      "Re-record the step, add a stable data-testid, or give the element a unique accessible label so it targets exactly one element."
    ].join("\n");
  }
}
