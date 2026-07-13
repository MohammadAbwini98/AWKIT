/**
 * Shared Chromium browser pool (Concurrency Capacity plan — Phase A5, experimental / flag-guarded).
 *
 * Lets many isolated browser contexts share a small number of Chromium processes instead of launching
 * one process per instance. Each lease is an isolated `BrowserContext` (own cookies/storage) on a
 * shared `Browser`; the pool packs contexts up to a hard per-browser limit for crash isolation, spreads
 * across browsers before packing, selects the least-loaded healthy browser, replaces crashed browsers,
 * and recycles a browser after it has created too many contexts.
 *
 * Framework-agnostic + fully injectable: the launcher creates the real Chromium `Browser`/`BrowserContext`
 * (or fakes in tests), so the pool logic is unit-testable without a real browser. Only shared-eligible
 * instances (browserContext isolation, no session-swap nodes) use this — see browserSharing.ts.
 */
import type { Browser, BrowserContext } from "playwright";

/** Creates the real (or fake) Chromium primitives. `launchKey` groups browsers that may be shared. */
export interface SharedBrowserLauncher {
  /** A stable key — only browsers with the SAME key may be shared (e.g. headed vs headless). */
  launchKey: string;
  launch(): Promise<Browser>;
  newContext(browser: Browser): Promise<BrowserContext>;
}

export interface SharedContextLease {
  browserId: string;
  browser: Browser;
  context: BrowserContext;
  /** Close this context and update the pool (recycle/drain the browser when it becomes idle). */
  release(): Promise<void>;
}

export interface SharedBrowserPoolOptions {
  /** Max shared browser processes alive at once (per launch key). */
  maxBrowsers: number;
  /** Target contexts per browser before spilling to another browser. */
  maxContextsPerBrowser: number;
  /** Hard cap on contexts per browser — always enforced for crash isolation. */
  maxContextsPerBrowserHardLimit: number;
  /** Recycle a browser after it has created this many contexts (drain then replace). */
  recycleAfterContexts: number;
}

export interface SharedBrowserSnapshot {
  totalBrowsers: number;
  healthyBrowsers: number;
  activeContexts: number;
  totalContextsCreated: number;
  totalBrowsersLaunched: number;
  totalBrowsersClosed: number;
  browsers: Array<{ id: string; launchKey: string; activeContexts: number; totalContextsCreated: number; unhealthy: boolean; recycling: boolean }>;
}

export class SharedBrowserPoolExhaustedError extends Error {
  constructor(launchKey: string, max: number) {
    super(`Shared browser pool exhausted for "${launchKey}" (${max} browsers all at their context limit).`);
    this.name = "SharedBrowserPoolExhaustedError";
  }
}

interface BrowserRecord {
  id: string;
  launchKey: string;
  browser: Browser;
  activeContexts: number;
  totalContextsCreated: number;
  unhealthy: boolean;
  recycling: boolean;
}

export class SharedBrowserPool {
  private readonly options: SharedBrowserPoolOptions;
  private readonly browsers = new Map<string, BrowserRecord>();
  private idCounter = 0;
  private launched = 0;
  private closed = 0;

  constructor(options: SharedBrowserPoolOptions) {
    this.options = { ...options };
  }

  /** Apply updated sizing from Settings/Auto (live). Only affects future context assignments. */
  setOptions(partial: Partial<SharedBrowserPoolOptions>): void {
    Object.assign(this.options, partial);
  }

  /** Effective per-browser context cap: the configured target, never above the hard limit. */
  private get contextCap(): number {
    return Math.max(1, Math.min(this.options.maxContextsPerBrowser, this.options.maxContextsPerBrowserHardLimit));
  }

  /**
   * Lease an isolated context on a shared browser. Spreads across browsers (for crash isolation) up to
   * `maxBrowsers`, then packs into the least-loaded healthy browser up to the hard context cap.
   */
  async acquireContext(launcher: SharedBrowserLauncher): Promise<SharedContextLease> {
    const key = launcher.launchKey;
    const record = await this.selectOrLaunch(launcher, key);
    const context = await launcher.newContext(record.browser);
    record.activeContexts += 1;
    record.totalContextsCreated += 1;
    if (record.totalContextsCreated >= this.options.recycleAfterContexts) {
      // Stop assigning NEW work to it; it drains and is closed once its last context releases.
      record.recycling = true;
    }
    return {
      browserId: record.id,
      browser: record.browser,
      context,
      release: () => this.releaseContext(record.id, context)
    };
  }

  private async selectOrLaunch(launcher: SharedBrowserLauncher, key: string): Promise<BrowserRecord> {
    const usable = [...this.browsers.values()].filter(
      (r) => r.launchKey === key && !r.unhealthy && !r.recycling && r.activeContexts < this.contextCap
    );
    // Recycling browsers are draining out and do not count against the browser cap — that lets a
    // replacement launch even while an old browser finishes its last contexts.
    const totalForKey = [...this.browsers.values()].filter((r) => r.launchKey === key && !r.unhealthy && !r.recycling).length;

    if (usable.length === 0) {
      if (totalForKey < this.options.maxBrowsers) return this.launchBrowser(launcher, key);
      throw new SharedBrowserPoolExhaustedError(key, this.options.maxBrowsers);
    }

    const leastLoaded = usable.reduce((a, b) => (b.activeContexts < a.activeContexts ? b : a));
    // Spread first: if we can still launch a browser and even the least-loaded one already holds work,
    // start a fresh browser so a single crash takes down fewer contexts.
    if (totalForKey < this.options.maxBrowsers && leastLoaded.activeContexts >= 1) {
      return this.launchBrowser(launcher, key);
    }
    return leastLoaded;
  }

  private async launchBrowser(launcher: SharedBrowserLauncher, key: string): Promise<BrowserRecord> {
    const browser = await launcher.launch();
    this.launched += 1;
    const record: BrowserRecord = {
      id: `sb-${++this.idCounter}`,
      launchKey: key,
      browser,
      activeContexts: 0,
      totalContextsCreated: 0,
      unhealthy: false,
      recycling: false
    };
    this.browsers.set(record.id, record);
    // A crashed/disconnected shared browser is never handed out again; its live contexts are lost.
    browser.on("disconnected", () => {
      const current = this.browsers.get(record.id);
      if (!current) return;
      current.unhealthy = true;
      current.activeContexts = 0;
      this.browsers.delete(record.id);
    });
    return record;
  }

  private async releaseContext(browserId: string, context: BrowserContext): Promise<void> {
    await context.close().catch(() => undefined);
    const record = this.browsers.get(browserId);
    if (!record) return; // browser already gone (crashed/closed)
    record.activeContexts = Math.max(0, record.activeContexts - 1);
    if (record.activeContexts === 0 && (record.recycling || record.unhealthy)) {
      await this.closeBrowser(record.id);
    }
  }

  private async closeBrowser(id: string): Promise<void> {
    const record = this.browsers.get(id);
    if (!record) return;
    this.browsers.delete(id);
    this.closed += 1;
    await record.browser.close().catch(() => undefined);
  }

  /** Close every browser with no active contexts (called at run end so idle Chromium doesn't linger). */
  async drainIdle(): Promise<void> {
    const idle = [...this.browsers.values()].filter((r) => r.activeContexts === 0);
    for (const record of idle) await this.closeBrowser(record.id);
  }

  /** Force-close every shared browser (engine shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.browsers.keys()];
    for (const id of all) await this.closeBrowser(id);
  }

  snapshot(): SharedBrowserSnapshot {
    const records = [...this.browsers.values()];
    return {
      totalBrowsers: records.length,
      healthyBrowsers: records.filter((r) => !r.unhealthy && !r.recycling).length,
      activeContexts: records.reduce((sum, r) => sum + r.activeContexts, 0),
      totalContextsCreated: records.reduce((sum, r) => sum + r.totalContextsCreated, 0),
      totalBrowsersLaunched: this.launched,
      totalBrowsersClosed: this.closed,
      browsers: records.map((r) => ({
        id: r.id,
        launchKey: r.launchKey,
        activeContexts: r.activeContexts,
        totalContextsCreated: r.totalContextsCreated,
        unhealthy: r.unhealthy,
        recycling: r.recycling
      }))
    };
  }
}
