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
 * **Ownership scope (PR #36 review fix).** ONE registry exists per Playwright BrowserContext /
 * runtime generation, owned by the runner's browser holder and shared by the parent flow, every
 * nested child flow, and every isolated parallel-branch executor. It is NOT constructed per
 * `StepExecutor`: doing so let a popup opened during a child flow be observed by both the parent's
 * and the child's registry, breaking `one Page → one identity owner → one public alias` at the
 * browser-context level.
 *
 * **Identity buckets.** Every observed page is filed into a bucket keyed by its derived identity.
 * The public alias for a bucket is granted only while exactly ONE eligible page occupies it, and
 * every membership change (close, release, claim-to-recorded-alias, mark-internal) re-reconciles
 * that bucket. This is what keeps ambiguity a statement about the CURRENT set of live pages rather
 * than a latched historical counter.
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
 *      wrong page — and that diagnostic is secret-masked.
 */
import { createHash } from "node:crypto";
import type { Frame, Page } from "playwright";
import { SecretMasker } from "@src/reports/SecretMasker";

/** Alias reserved for the primary page; never assignable to a popup. */
export const MAIN_PAGE_ALIAS = "main";

/** How long a page whose URL had not committed at observation time may take to finalize identity. */
const PENDING_IDENTITY_BUDGET_MS = 5_000;

/** Outcome of observing a newly created `Page` at the context-level `"page"` event. */
export interface PopupObservation {
  /** The public alias assigned, or `undefined` when identity is pending or contested. */
  alias?: string;
  /**
   * True when a public alias is withheld because another live page shares this identity.
   * Resolving the contested alias fails explicitly instead of guessing (invariant 8).
   */
  ambiguous: boolean;
}

/** Raised when an alias cannot be resolved to exactly one live page. Messages are secret-masked. */
export class PopupIdentityError extends Error {}

export class PopupIdentityRegistry {
  private readonly aliasToPage = new Map<string, Page>();
  private readonly pageToAlias = new Map<Page, string>();
  /** Page → the identity bucket it was filed into (its candidate synthetic alias). */
  private readonly identityOf = new Map<Page, string>();
  /** Identity → every page that derived it, eligible or not. */
  private readonly buckets = new Map<string, Set<Page>>();
  /** Pages the runner itself owns (main, isolated parallel-branch pages) — never popup-aliased. */
  private readonly internalPages = new Set<Page>();
  /** Close handlers, kept so they can be detached (no listener growth across popup lifecycles). */
  private readonly closeHandlers = new Map<Page, () => void>();
  /** Cancel functions for in-flight identity finalization, so `markInternal` can stop one. */
  private readonly pendingCancel = new Map<Page, () => void>();
  /** In-flight identity finalizations, awaited by `settle()`. */
  private readonly pendingTasks = new Set<Promise<void>>();
  /** Masks secrets out of every user-facing identity diagnostic (FR-H1). */
  private readonly masker = new SecretMasker();

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
    this.cancelPending(page);
    this.detachFromBucket(page);
    this.internalPages.add(page);
    this.aliasToPage.set(MAIN_PAGE_ALIAS, page);
    this.pageToAlias.set(page, MAIN_PAGE_ALIAS);
  }

  /**
   * Mark a page the runner created for itself (an isolated parallel-branch page). It shares the
   * browser context, so it raises the same `"page"` event a popup does — without this it would
   * consume a popup alias and a recorded `popup-1` could resolve to a branch page.
   *
   * Production ordering is: the `"page"` event fires on an uncommitted `about:blank` page and
   * schedules finalization, `context.newPage()` THEN resolves, and only then does the runner mark
   * the page internal — after which the branch navigates. Cancelling the pending finalization here
   * (and re-checking `internalPages` inside it) is what stops that later navigation from assigning
   * a popup alias to a runner-owned page.
   */
  markInternal(page: Page): void {
    this.cancelPending(page);
    const alias = this.pageToAlias.get(page);
    if (alias !== undefined && alias !== MAIN_PAGE_ALIAS) {
      this.pageToAlias.delete(page);
      if (this.aliasToPage.get(alias) === page) this.aliasToPage.delete(alias);
    }
    this.internalPages.add(page);
    this.detachFromBucket(page);
    this.trackClose(page);
  }

  /**
   * Observe a newly created `Page`. This is the ONLY place a popup enters the registry (C1.1).
   *
   * Identity is derived from the page itself, never from arrival order, so two popups opening in
   * reversed order across runs resolve to the same aliases in both runs (C1.5).
   */
  observe(page: Page): PopupObservation {
    if (this.internalPages.has(page)) return { alias: this.pageToAlias.get(page), ambiguous: false };

    const existing = this.pageToAlias.get(page);
    if (existing) return { alias: existing, ambiguous: false };
    if (this.identityOf.has(page)) {
      const identity = this.identityOf.get(page) as string;
      return { alias: undefined, ambiguous: this.eligibleIn(identity).length > 1 };
    }
    // Idempotent: observing an already-pending page again must NOT schedule a second finalization,
    // which would leave a duplicate `framenavigated`/`close` listener and timer behind for the same
    // Page. Re-observation is normal — a caller may observe explicitly alongside the context handler.
    if (this.pendingCancel.has(page)) return { alias: undefined, ambiguous: false };

    this.trackClose(page);
    const url = safeUrl(page);

    // The URL is normally already committed when the `"page"` event fires. When it is not
    // (`window.open()` with no URL, a document.write popup), identity is finalized on the first
    // main-frame navigation instead of being guessed from a placeholder that would differ per run.
    if (!url) {
      this.schedulePendingIdentity(page);
      return { alias: undefined, ambiguous: false };
    }

    return this.admit(page, url);
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
    if (previous !== undefined && this.aliasToPage.get(previous) === page) this.aliasToPage.delete(previous);

    // A closed page must never keep an alias reserved (invariant 6/7).
    const holder = this.aliasToPage.get(alias);
    const displacedIdentity = holder && holder !== page ? this.identityOf.get(holder) : undefined;
    if (holder && holder !== page) this.pageToAlias.delete(holder);

    this.aliasToPage.set(alias, page);
    this.pageToAlias.set(page, alias);
    this.trackClose(page);

    // The claimant now holds a RECORDED alias, so it is no longer an eligible occupant of its
    // synthetic bucket — a popup that was contesting that identity can now take it outright.
    const ownIdentity = this.identityOf.get(page);
    if (ownIdentity) this.reconcile(ownIdentity);
    if (displacedIdentity) this.reconcile(displacedIdentity);
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

  /**
   * Every currently-registered alias, for user-facing diagnostics. Aliases are non-secret by
   * construction: a synthetic alias is `popup-<hash>` and carries no caller-controlled text.
   */
  aliases(): string[] {
    return [...this.aliasToPage.keys()];
  }

  /** Drop an alias (an explicit `closePopup` step). The page's reverse mapping goes with it. */
  release(alias: string): void {
    const page = this.aliasToPage.get(alias);
    this.aliasToPage.delete(alias);
    if (!page) return;
    this.pageToAlias.delete(page);
    // Releasing frees the page to reclaim its synthetic identity, or frees a contender to take it.
    const identity = this.identityOf.get(page);
    if (identity) this.reconcile(identity);
  }

  /**
   * Await any in-flight identity finalization, bounded. Called before reporting an alias as missing
   * so a popup whose URL committed late is not mistaken for one that never opened.
   */
  async settle(timeoutMs = 2_000): Promise<void> {
    if (this.pendingTasks.size === 0) return;
    const pending = [...this.pendingTasks];
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

  /** Count of in-flight identity finalizations — used by tests to prove listeners do not accumulate. */
  pendingIdentityCount(): number {
    return this.pendingTasks.size;
  }

  /**
   * Rebind this registry onto a freshly launched BrowserContext (Auto Secure Login / Reuse Session
   * restart). Every page from the previous generation is gone, so all mappings and listeners are
   * released and `main` is re-seeded. The registry INSTANCE is preserved deliberately: the parent,
   * child, and branch executors already hold a reference to it, and swapping in a new object would
   * silently leave them owning a dead registry.
   */
  resetForNewContext(mainPage: Page): void {
    for (const cancel of [...this.pendingCancel.values()]) cancel();
    for (const [page, handler] of this.closeHandlers) page.off("close", handler);
    this.closeHandlers.clear();
    this.pendingCancel.clear();
    this.pendingTasks.clear();
    this.aliasToPage.clear();
    this.pageToAlias.clear();
    this.identityOf.clear();
    this.buckets.clear();
    this.internalPages.clear();
    this.internalPages.add(mainPage);
    this.aliasToPage.set(MAIN_PAGE_ALIAS, mainPage);
    this.pageToAlias.set(mainPage, MAIN_PAGE_ALIAS);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** File a page whose URL is known into its identity bucket, then reconcile that bucket. */
  private admit(page: Page, url: URL): PopupObservation {
    const identity = derivePopupAlias(url);
    this.identityOf.set(page, identity);
    const bucket = this.buckets.get(identity) ?? new Set<Page>();
    bucket.add(page);
    this.buckets.set(identity, bucket);
    this.reconcile(identity);
    const alias = this.pageToAlias.get(page);
    return { alias, ambiguous: alias === undefined && this.eligibleIn(identity).length > 1 };
  }

  /** Pages still competing for a bucket's public alias: live, not internal, not recorded-aliased. */
  private eligibleIn(identity: string): Page[] {
    const bucket = this.buckets.get(identity);
    if (!bucket) return [];
    const eligible: Page[] = [];
    for (const page of bucket) {
      if (page.isClosed() || this.internalPages.has(page)) continue;
      const alias = this.pageToAlias.get(page);
      if (alias !== undefined && alias !== identity) continue; // holds a recorded alias instead
      eligible.push(page);
    }
    return eligible;
  }

  /**
   * Re-derive a bucket's public alias from its CURRENT membership. Exactly one eligible page grants
   * the alias; zero removes it; two or more leaves it explicitly ambiguous. Called on every
   * membership change so ambiguity can never latch after a popup closes or is rebound.
   */
  private reconcile(identity: string): void {
    const bucket = this.buckets.get(identity);
    if (bucket) {
      for (const page of [...bucket]) {
        if (page.isClosed()) {
          bucket.delete(page);
          this.identityOf.delete(page);
        }
      }
      if (bucket.size === 0) this.buckets.delete(identity);
    }

    const eligible = this.eligibleIn(identity);
    const currentHolder = this.aliasToPage.get(identity);

    if (eligible.length === 1) {
      const winner = eligible[0];
      if (currentHolder && currentHolder !== winner) this.pageToAlias.delete(currentHolder);
      this.aliasToPage.set(identity, winner);
      this.pageToAlias.set(winner, identity);
      return;
    }

    // Zero eligible, or genuinely contested: the identity grants no public alias at all.
    if (currentHolder) {
      if (this.pageToAlias.get(currentHolder) === identity) this.pageToAlias.delete(currentHolder);
      this.aliasToPage.delete(identity);
    }
  }

  /** Remove a page from its identity bucket and reconcile what is left behind. */
  private detachFromBucket(page: Page): void {
    const identity = this.identityOf.get(page);
    if (identity === undefined) return;
    this.identityOf.delete(page);
    this.buckets.get(identity)?.delete(page);
    this.reconcile(identity);
  }

  /**
   * Finalize identity once the main frame commits a URL, bounded so a listener never leaks. Every
   * exit path detaches both listeners, clears the timer, and drops the pending task.
   */
  private schedulePendingIdentity(page: Page): void {
    let resolveTask!: () => void;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      page.off("framenavigated", onNavigated);
      page.off("close", onClose);
      clearTimeout(timer);
      this.pendingCancel.delete(page);
      this.pendingTasks.delete(task);
      resolveTask();
    };
    const onNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      // The page may have become runner-owned between observation and this navigation — that is the
      // exact production ordering for a parallel-branch page. It must never gain a popup alias.
      if (this.internalPages.has(page)) {
        finish();
        return;
      }
      const url = safeUrl(page);
      if (!url) return; // another about:blank commit — keep waiting for a real URL
      finish();
      if (!this.pageToAlias.has(page) && !this.identityOf.has(page) && !page.isClosed()) {
        this.admit(page, url);
      }
    };
    const onClose = (): void => finish();

    timer = setTimeout(finish, PENDING_IDENTITY_BUDGET_MS);
    page.on("framenavigated", onNavigated);
    page.on("close", onClose);
    this.pendingCancel.set(page, finish);
    this.pendingTasks.add(task);
  }

  private cancelPending(page: Page): void {
    this.pendingCancel.get(page)?.();
  }

  /** Reject a claim that would make one alias resolve to two live pages (invariant 3/8). */
  private assertClaimable(alias: string, claimant?: Page): void {
    if (alias === MAIN_PAGE_ALIAS) {
      throw new PopupIdentityError(
        this.mask(
          `Alias "${alias}" is reserved for the main page and cannot be claimed by a popup.`
        )
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
      this.mask(
        `Popup alias "${alias}" is already held by a different live page. ` +
        `Two popups cannot share one alias; close the first popup before reusing its alias.`
      )
    );
  }

  private assertNotAmbiguous(alias: string): void {
    if (!this.buckets.has(alias)) return;
    const eligible = this.eligibleIn(alias);
    if (eligible.length < 2) return;
    throw new PopupIdentityError(
      this.mask(
        `Popup alias "${alias}" is ambiguous: ${eligible.length} live popups share the same stable ` +
        `identity (same origin and path), so it cannot identify one page. ` +
        `Record an explicit popupExpectation.popupAlias for each popup to disambiguate them.`
      )
    );
  }

  /**
   * Mask every identity diagnostic before it leaves the registry (FR-H1). A recorded alias is
   * caller-controlled flow content and can carry a token, a password, or a registered literal
   * secret; a diagnostic must never become the channel that discloses it.
   */
  private mask(message: string): string {
    return this.masker.maskText(message);
  }

  /** Remove every trace of a page — both directions (invariant 5) — and reconcile its bucket. */
  private forget(page: Page): void {
    const alias = this.pageToAlias.get(page);
    this.pageToAlias.delete(page);
    if (alias !== undefined && this.aliasToPage.get(alias) === page) this.aliasToPage.delete(alias);
    this.internalPages.delete(page);
    this.cancelPending(page);
    this.detachFromBucket(page);
  }

  private trackClose(page: Page): void {
    if (this.closeHandlers.has(page)) return;
    const handler = (): void => {
      this.forget(page);
      page.off("close", handler);
      this.closeHandlers.delete(page);
    };
    this.closeHandlers.set(page, handler);
    page.on("close", handler);
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
 * Derive a popup's deterministic alias: `popup-<hash>` (FR-C1.3).
 *
 * Identity material is the popup's ORIGIN and normalized PATHNAME — stable across runs and
 * independent of arrival order. The URL's query string and fragment are never read, so a token in
 * `?token=…` or `#…` is structurally unable to reach an alias or a diagnostic.
 *
 * **The output is a fixed neutral prefix plus a hash, and never echoes its inputs** (PR #36 review
 * fix). An earlier revision embedded the opener's alias as readable text; because a recorded alias
 * is caller-controlled, an opener named `token-…` or `password-…` would have been visible in every
 * child popup's alias. `safePathComponent` makes text filesystem-safe, not secret-safe, so the fix
 * is structural: only the hash may depend on identity material.
 *
 * Three candidate inputs are deliberately excluded. The **active step id** is timing-dependent for a
 * timer-opened popup (whichever step happens to be running when it fires); **`window.name`** is only
 * readable through an async `evaluate`; and the **opener alias** is only available synchronously as
 * "whichever executor is currently active", which varies with child-flow nesting. Folding any of
 * them in would make identity depend on a race, reintroducing exactly the run-to-run instability
 * C1.5 forbids. A popup that IS causally tied to a step carries a recorded
 * `popupExpectation.popupAlias`, which wins outright (C1.2); two popups that share an origin and
 * path are reported as ambiguous rather than guessed apart.
 */
export function derivePopupAlias(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const material = `${url.origin}\n${pathname}`;
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 12);
  return `popup-${hash}`;
}
