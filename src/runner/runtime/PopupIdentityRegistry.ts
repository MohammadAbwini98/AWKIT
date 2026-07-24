/**
 * PopupIdentityRegistry — the single owner of page/popup identity (SRS-BAO-001 FR-C1, Tranche 2A).
 *
 * FR-C1 requires that every page have exactly one stable identity for its lifetime, assigned by
 * exactly one owner, with positional aliasing removed. Before this module, two independent call
 * sites registered the same popup: `PlaywrightRunner`'s context-level `"page"` handler (under a
 * positional `popup-${counter}` key) and `StepExecutor`'s click / `switchToPopup` paths (under the
 * recorded alias). One `Page` was therefore reachable under two aliases, and identity depended on
 * arrival order — defect `awkit-ebh`.
 *
 * The reconciliation (deliberately not "delete one call site" — each covered a case the other did
 * not) is ownership inversion:
 *
 *   - The context-level `"page"` event is the SINGLE observation point. Every new `Page` is observed
 *     here exactly once and given a deterministic synthetic identity.
 *   - Step paths that expect a popup no longer register anything. They CLAIM the `Page` object they
 *     awaited, which atomically promotes it from its synthetic alias to the recorded alias. The
 *     synthetic key is removed in the same operation, so the registry never holds both (C1.2).
 *
 * Invariants (each asserted by `verify:popup-identity`):
 *   1. `main` is reserved for the main page.
 *   2. One live `Page` has at most one public alias  (C1.4 — registry values are distinct).
 *   3. One alias resolves to at most one live `Page`.
 *   4. Rebinding a page to a recorded alias removes its previous alias atomically.
 *   5. Closing a page removes BOTH the forward and reverse mapping.
 *   6. A closed page neither retains nor blocks an alias.
 *   7. A reopened logical popup may reuse its recorded alias once the previous page is closed (C1.6).
 *   8. Duplicate or ambiguous claims fail with a clear diagnostic rather than silently targeting the
 *      wrong page.
 */
import { createHash } from "node:crypto";
import type { Frame, Page } from "playwright";
import { safePathComponent } from "../../utils/pathSafety.js";

/** Alias reserved for the primary page; never assignable to a popup. */
export const MAIN_PAGE_ALIAS = "main";

/** Outcome of observing a newly created `Page` at the context-level `"page"` event. */
export interface PopupObservation {
  /** The public alias assigned, or `undefined` when identity is pending or contested. */
  alias?: string;
  /**
   * True when a public alias was withheld because another live page already holds this identity.
   * Resolving the contested alias fails explicitly instead of guessing (invariant 8).
   */
  ambiguous: boolean;
}

/** Raised when an alias cannot be resolved to exactly one live page. */
export class PopupIdentityError extends Error {}

export class PopupIdentityRegistry {
  private readonly aliasToPage = new Map<string, Page>();
  private readonly pageToAlias = new Map<Page, string>();
  /** Pages observed but withheld a public alias because their identity is contested. */
  private readonly contestedPages = new Map<Page, string>();
  /** Live extra pages per contested alias; an alias is ambiguous while this is > 0. */
  private readonly ambiguityCount = new Map<string, number>();
  /** Pages the runner itself owns (main, isolated parallel-branch pages) — never popup-aliased. */
  private readonly internalPages = new Set<Page>();
  /** Pages already wired for close cleanup, so a listener is attached at most once per page. */
  private readonly closeTracked = new Set<Page>();
  /** In-flight identity finalizations for pages whose URL had not committed at observation time. */
  private readonly pendingIdentity = new Set<Promise<void>>();

  constructor(mainPage: Page) {
    this.internalPages.add(mainPage);
    this.aliasToPage.set(MAIN_PAGE_ALIAS, mainPage);
    this.pageToAlias.set(mainPage, MAIN_PAGE_ALIAS);
  }

  /**
   * Re-point `main` at a freshly launched page (browser restart / Reuse Session). The previous main
   * page's reverse mapping is dropped so a stale page can never keep answering to `main`.
   */
  setMainPage(page: Page): void {
    const previous = this.aliasToPage.get(MAIN_PAGE_ALIAS);
    if (previous && previous !== page) {
      this.pageToAlias.delete(previous);
      this.internalPages.delete(previous);
    }
    this.internalPages.add(page);
    this.aliasToPage.set(MAIN_PAGE_ALIAS, page);
    this.pageToAlias.set(page, MAIN_PAGE_ALIAS);
  }

  /**
   * Mark a page the runner created for its own purposes (an isolated parallel-branch page). Such a
   * page shares the browser context, so it fires the same `"page"` event a popup does — without this
   * it would consume a popup alias and a recorded `popup-1` could resolve to a branch page.
   */
  markInternal(page: Page): void {
    // The `"page"` event can arrive before `context.newPage()` resolves, so this page may already
    // have been observed and given a popup alias. Drop it before marking the page internal —
    // otherwise a recorded `popup-1` could later resolve to a branch page.
    const alias = this.pageToAlias.get(page);
    if (alias !== undefined && alias !== MAIN_PAGE_ALIAS) {
      this.pageToAlias.delete(page);
      if (this.aliasToPage.get(alias) === page) this.aliasToPage.delete(alias);
    }
    this.releaseContested(page);
    this.internalPages.add(page);
    this.trackClose(page);
  }

  /**
   * Observe a newly created `Page`. This is the ONLY place a popup enters the registry (C1.1).
   *
   * Identity is derived from the page itself, never from arrival order, so two popups opening in
   * reversed order across runs resolve to the same aliases in both runs (C1.5).
   */
  observe(page: Page, hints: { openerAlias?: string } = {}): PopupObservation {
    if (this.internalPages.has(page)) return { alias: this.pageToAlias.get(page), ambiguous: false };

    const existing = this.pageToAlias.get(page);
    if (existing) return { alias: existing, ambiguous: false };

    this.trackClose(page);
    const openerAlias = hints.openerAlias ?? MAIN_PAGE_ALIAS;
    const url = safeUrl(page);

    // The URL is normally already committed when the `"page"` event fires. When it is not
    // (`window.open()` with no URL, a document.write popup), identity is finalized on the first
    // main-frame navigation instead of being guessed from a placeholder that would differ per run.
    if (!url) {
      this.schedulePendingIdentity(page, openerAlias);
      return { alias: undefined, ambiguous: false };
    }

    return this.assignDerived(page, openerAlias, url);
  }

  /**
   * Declare that an alias is about to be claimed by an action being triggered now. Purely a
   * pre-flight consistency check (invariant 8): it surfaces a conflicting live claim BEFORE the
   * action runs, rather than after the popup has already been acted upon.
   */
  declareExpected(alias: string): void {
    this.assertClaimable(alias);
  }

  /**
   * Promote a `Page` to its recorded alias, atomically dropping whatever synthetic alias it was
   * observed under (C1.2, invariant 4). This is how a recorded alias wins — never by a second
   * independent registration.
   */
  claim(page: Page, alias: string): void {
    if (this.pageToAlias.get(page) === alias) return;
    this.assertClaimable(alias, page);

    // Atomic rebind: drop the previous forward key before installing the new one, so the registry
    // is never observable with one page under two aliases.
    const previous = this.pageToAlias.get(page);
    if (previous !== undefined) this.aliasToPage.delete(previous);
    this.releaseContested(page);

    // A closed page must never keep an alias reserved (invariant 6/7).
    const holder = this.aliasToPage.get(alias);
    if (holder && holder !== page) this.pageToAlias.delete(holder);

    this.aliasToPage.set(alias, page);
    this.pageToAlias.set(page, alias);
    this.trackClose(page);
  }

  /** Resolve an alias to its live page, or `undefined` when it is unknown. Throws when ambiguous. */
  tryResolve(alias: string): Page | undefined {
    this.assertNotAmbiguous(alias);
    const page = this.aliasToPage.get(alias);
    if (page && page.isClosed()) {
      this.forget(page);
      return undefined;
    }
    return page;
  }

  /** The alias a page is registered under, or `undefined` when it holds no public alias. */
  aliasFor(page: Page): string | undefined {
    return this.pageToAlias.get(page);
  }

  /** Every currently-registered alias, for user-facing diagnostics. Aliases are non-secret by construction. */
  aliases(): string[] {
    return [...this.aliasToPage.keys()];
  }

  /** Drop an alias (an explicit `closePopup` step). The page's reverse mapping goes with it. */
  release(alias: string): void {
    const page = this.aliasToPage.get(alias);
    this.aliasToPage.delete(alias);
    if (page) {
      this.pageToAlias.delete(page);
      this.releaseContested(page);
    }
  }

  /**
   * Await any in-flight identity finalization, bounded. Called before reporting an alias as missing
   * so a popup whose URL committed late is not mistaken for one that never opened.
   */
  async settle(timeoutMs = 2_000): Promise<void> {
    if (this.pendingIdentity.size === 0) return;
    const pending = [...this.pendingIdentity];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([Promise.allSettled(pending).then(() => undefined), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Assign the deterministic identity for a page whose URL is known. */
  private assignDerived(page: Page, openerAlias: string, url: URL): PopupObservation {
    const alias = derivePopupAlias(openerAlias, url);
    const holder = this.aliasToPage.get(alias);

    if (holder && holder !== page && !holder.isClosed()) {
      // Genuinely indistinguishable from the available stable identity. Withhold a public alias and
      // mark the alias ambiguous rather than falling back to arrival order (invariant 8).
      this.contestedPages.set(page, alias);
      this.ambiguityCount.set(alias, (this.ambiguityCount.get(alias) ?? 0) + 1);
      return { alias: undefined, ambiguous: true };
    }

    if (holder && holder !== page) this.pageToAlias.delete(holder);
    this.aliasToPage.set(alias, page);
    this.pageToAlias.set(page, alias);
    return { alias, ambiguous: false };
  }

  /** Finalize identity once the main frame commits a URL, bounded so a listener never leaks. */
  private schedulePendingIdentity(page: Page, openerAlias: string): void {
    const task = new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        page.off("framenavigated", onNavigated);
        clearTimeout(timer);
        resolve();
      };
      const onNavigated = (frame: Frame): void => {
        if (frame !== page.mainFrame()) return;
        const url = safeUrl(page);
        // Still not identity-bearing (another about:blank commit) — keep waiting for a real URL.
        if (!url) return;
        if (!this.pageToAlias.has(page) && !this.contestedPages.has(page) && !page.isClosed()) {
          this.assignDerived(page, openerAlias, url);
        }
        finish();
      };
      page.on("framenavigated", onNavigated);
      page.once("close", finish);
      const timer = setTimeout(finish, 5_000);
    }).finally(() => {
      this.pendingIdentity.delete(task);
    });
    this.pendingIdentity.add(task);
  }

  /** Reject a claim that would make one alias resolve to two live pages (invariant 3/8). */
  private assertClaimable(alias: string, claimant?: Page): void {
    if (alias === MAIN_PAGE_ALIAS) {
      throw new PopupIdentityError(
        `Alias "${MAIN_PAGE_ALIAS}" is reserved for the main page and cannot be claimed by a popup.`
      );
    }
    const holder = this.aliasToPage.get(alias);
    if (!holder || holder === claimant) return;
    if (holder.isClosed()) {
      // A closed page never blocks its alias — the reopened popup may take it (invariant 7).
      this.forget(holder);
      return;
    }
    throw new PopupIdentityError(
      `Popup alias "${alias}" is already held by a different live page. ` +
      `Two popups cannot share one alias; close the first popup before reusing its alias.`
    );
  }

  private assertNotAmbiguous(alias: string): void {
    this.pruneAmbiguity(alias);
    const extra = this.ambiguityCount.get(alias);
    if (!extra) return;
    throw new PopupIdentityError(
      `Popup alias "${alias}" is ambiguous: ${extra + 1} live popups share the same stable identity ` +
      `(same opener, origin, and path), so it cannot identify one page. ` +
      `Record an explicit popupExpectation.popupAlias for each popup to disambiguate them.`
    );
  }

  /** Drop ambiguity bookkeeping for pages that have since closed. */
  private pruneAmbiguity(alias: string): void {
    if (!this.ambiguityCount.has(alias)) return;
    for (const [page, contested] of this.contestedPages) {
      if (contested === alias && page.isClosed()) this.releaseContested(page);
    }
  }

  private releaseContested(page: Page): void {
    const alias = this.contestedPages.get(page);
    if (alias === undefined) return;
    this.contestedPages.delete(page);
    const next = (this.ambiguityCount.get(alias) ?? 1) - 1;
    if (next > 0) this.ambiguityCount.set(alias, next);
    else this.ambiguityCount.delete(alias);
  }

  /** Remove every trace of a page — both directions (invariant 5). */
  private forget(page: Page): void {
    const alias = this.pageToAlias.get(page);
    this.pageToAlias.delete(page);
    if (alias !== undefined && this.aliasToPage.get(alias) === page) this.aliasToPage.delete(alias);
    this.releaseContested(page);
    this.internalPages.delete(page);
  }

  private trackClose(page: Page): void {
    if (this.closeTracked.has(page)) return;
    this.closeTracked.add(page);
    page.once("close", () => {
      this.forget(page);
      this.closeTracked.delete(page);
    });
  }
}

/** `page.url()` as a parsed URL, or `undefined` when it is not yet identity-bearing. */
function safeUrl(page: Page): URL | undefined {
  let raw: string;
  try {
    raw = page.url();
  } catch {
    return undefined;
  }
  if (!raw || raw === "about:blank") return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "about:" || url.protocol === "blob:" ? undefined : url;
  } catch {
    return undefined;
  }
}

/**
 * Derive a popup's deterministic alias: `popup-<safe-opener>-<hash>` (FR-C1.3).
 *
 * Identity material is the opener's alias plus the popup's ORIGIN and normalized PATHNAME — stable
 * across runs and independent of arrival order. The URL's query string and fragment are never read,
 * so a token in `?token=…` or `#…` is structurally unable to reach an alias or a diagnostic.
 *
 * Two candidate inputs are deliberately excluded. The **active step id** is timing-dependent for a
 * timer-opened popup (whichever step happens to be running when it fires), and `window.name` is only
 * readable through an async `evaluate` — folding either in would make identity depend on a race,
 * reintroducing exactly the run-to-run instability C1.5 forbids. A popup that IS causally tied to a
 * step carries a recorded `popupExpectation.popupAlias`, which wins outright (C1.2).
 */
export function derivePopupAlias(openerAlias: string, url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const material = `${openerAlias}\n${url.origin}\n${pathname}`;
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 8);
  return `popup-${safePathComponent(openerAlias, MAIN_PAGE_ALIAS)}-${hash}`;
}
