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

/**
 * Exact reason a pooled browser was retired/closed — so lifecycle telemetry can distinguish routine
 * context-count recycling and idle draining from memory-threshold recycling, crashes, and shutdown.
 * Memory-based recycling (`MEMORY_THRESHOLD`) only occurs when per-browser memory attribution is available.
 */
export type SharedBrowserCloseReason =
  | "CONTEXT_COUNT_RECYCLE" // reached recycleAfterContexts → drained + replaced
  | "MEMORY_THRESHOLD"      // subtree RSS held over budget (only when per-browser attribution works)
  | "IDLE_DRAIN"            // closed while idle at run end so no Chromium lingers
  | "UNHEALTHY"             // marked unhealthy (defensive; distinct from an observed disconnect)
  | "CRASH"                 // unexpected browser "disconnected" (process died / was killed)
  | "POOL_SHUTDOWN"         // closeAll on engine/pool shutdown
  | "LAUNCH_FAILURE"        // launcher.launch() threw (no record ever entered the pool)
  | "OTHER";

export const SHARED_BROWSER_CLOSE_REASONS: SharedBrowserCloseReason[] = [
  "CONTEXT_COUNT_RECYCLE", "MEMORY_THRESHOLD", "IDLE_DRAIN", "UNHEALTHY",
  "CRASH", "POOL_SHUTDOWN", "LAUNCH_FAILURE", "OTHER"
];

function emptyCloseReasonCounts(): Record<SharedBrowserCloseReason, number> {
  return {
    CONTEXT_COUNT_RECYCLE: 0, MEMORY_THRESHOLD: 0, IDLE_DRAIN: 0, UNHEALTHY: 0,
    CRASH: 0, POOL_SHUTDOWN: 0, LAUNCH_FAILURE: 0, OTHER: 0
  };
}

export interface SharedBrowserSnapshot {
  totalBrowsers: number;
  healthyBrowsers: number;
  activeContexts: number;
  totalContextsCreated: number;
  totalBrowsersLaunched: number;
  totalBrowsersClosed: number;
  /** Cumulative browser retirements grouped by exact reason (crashes + launch failures included). */
  closeReasons: Record<SharedBrowserCloseReason, number>;
  /** Browser launches that threw before any record existed (also counted under closeReasons.LAUNCH_FAILURE). */
  launchFailures: number;
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
  /** Why this browser is being retired, set when it is first flagged recycling/unhealthy; read at close. */
  retireReason?: SharedBrowserCloseReason;
  /** Root Chromium PID (for per-browser memory attribution); undefined for remote/fake browsers. */
  rootPid?: number;
  /** Moving window of recent subtree-RSS samples (MB) for memory-based recycling (never a single spike). */
  memWindow: number[];
}

export class SharedBrowserPool {
  private readonly options: SharedBrowserPoolOptions;
  private readonly browsers = new Map<string, BrowserRecord>();
  private idCounter = 0;
  private launched = 0;
  private closed = 0;
  private launchFailures = 0;
  private readonly closeReasonCounts = emptyCloseReasonCounts();
  /** Serializes the browser select+launch+reserve decision so concurrent leases can't over-launch. */
  private selectionLock: Promise<unknown> = Promise.resolve();

  constructor(options: SharedBrowserPoolOptions) {
    this.options = { ...options };
  }

  /**
   * Run `fn` mutually exclusive with every other selection. The queue is kept alive even when a call
   * rejects, so one failed launch never poisons the mutex for later leases.
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.selectionLock.then(fn, fn);
    this.selectionLock = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
    // Select-or-launch AND reserve the context slot atomically. Doing the reservation under the mutex —
    // BEFORE the (slow) newContext — is what closes the concurrent over-launch race: a second lease that
    // arrives while a browser is still launching now sees the reserved browser + its reserved contexts and
    // packs/spreads correctly instead of launching another Chromium past maxBrowsers.
    const record = await this.runExclusive(async () => {
      const chosen = await this.selectOrLaunch(launcher, key);
      chosen.activeContexts += 1;
      chosen.totalContextsCreated += 1;
      if (chosen.totalContextsCreated >= this.options.recycleAfterContexts) {
        // Stop assigning NEW work to it; it drains and is closed once its last context releases.
        chosen.recycling = true;
        chosen.retireReason ??= "CONTEXT_COUNT_RECYCLE";
      }
      return chosen;
    });

    let context: BrowserContext;
    try {
      context = await launcher.newContext(record.browser);
    } catch (error) {
      // Roll back the reservation so a failed context never leaks a slot or keeps a browser alive.
      await this.releaseReservation(record.id);
      throw error;
    }

    return {
      browserId: record.id,
      browser: record.browser,
      context,
      release: () => this.releaseContext(record.id, context)
    };
  }

  /** Undo a reservation whose context never opened (activeContexts was pre-incremented at reserve time). */
  private async releaseReservation(browserId: string): Promise<void> {
    const record = this.browsers.get(browserId);
    if (!record) return;
    record.activeContexts = Math.max(0, record.activeContexts - 1);
    if (record.activeContexts === 0 && (record.recycling || record.unhealthy)) {
      await this.closeBrowser(record.id);
    }
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
    let browser: Browser;
    try {
      browser = await launcher.launch();
    } catch (error) {
      this.launchFailures += 1;
      this.closeReasonCounts.LAUNCH_FAILURE += 1;
      throw error;
    }
    this.launched += 1;
    // Per-browser root PID for memory attribution. Playwright's public Browser type carries no process
    // handle (only BrowserServer / ElectronApplication do), and a locally-launched Browser exposes none at
    // runtime on Playwright 1.61 — so this stays undefined here and memory recycling is inert. Kept so a
    // launch path that DOES surface a root PID (remote browser server / a future API) enables it unchanged.
    const withProcess = browser as unknown as { process?: () => { pid?: number } | null | undefined };
    const rootPid = typeof withProcess.process === "function" ? withProcess.process()?.pid : undefined;
    const record: BrowserRecord = {
      id: `sb-${++this.idCounter}`,
      launchKey: key,
      browser,
      activeContexts: 0,
      totalContextsCreated: 0,
      unhealthy: false,
      recycling: false,
      rootPid,
      memWindow: []
    };
    this.browsers.set(record.id, record);
    // A crashed/disconnected shared browser is never handed out again; its live contexts are lost. Our OWN
    // closeBrowser() deletes the record BEFORE calling browser.close(), so this handler only fires with the
    // record still present on an UNEXPECTED disconnect — i.e. a real crash/kill — never on an intentional close.
    browser.on("disconnected", () => {
      const current = this.browsers.get(record.id);
      if (!current) return;
      current.unhealthy = true;
      current.activeContexts = 0;
      this.browsers.delete(record.id);
      this.closed += 1;
      this.closeReasonCounts.CRASH += 1;
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

  private async closeBrowser(id: string, reason?: SharedBrowserCloseReason): Promise<void> {
    const record = this.browsers.get(id);
    if (!record) return;
    this.browsers.delete(id);
    this.closed += 1;
    // Prefer the caller's explicit reason, else the reason stamped when the browser was flagged, else OTHER.
    const attributed: SharedBrowserCloseReason = reason ?? record.retireReason ?? "OTHER";
    this.closeReasonCounts[attributed] += 1;
    await record.browser.close().catch(() => undefined);
  }

  /** Close every browser with no active contexts (called at run end so idle Chromium doesn't linger). */
  async drainIdle(): Promise<void> {
    const idle = [...this.browsers.values()].filter((r) => r.activeContexts === 0);
    // If a browser was already flagged for recycling, keep that (more specific) reason; else it's an idle drain.
    for (const record of idle) await this.closeBrowser(record.id, record.retireReason ?? "IDLE_DRAIN");
  }

  /** Force-close every shared browser (engine shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.browsers.keys()];
    for (const id of all) await this.closeBrowser(id, "POOL_SHUTDOWN");
  }

  /** Root PIDs of the browsers eligible for memory sampling (skips remote/fake, already-draining, crashed). */
  browserRoots(): Array<{ id: string; pid: number }> {
    const out: Array<{ id: string; pid: number }> = [];
    for (const r of this.browsers.values()) {
      if (r.rootPid && !r.recycling && !r.unhealthy) out.push({ id: r.id, pid: r.rootPid });
    }
    return out;
  }

  /**
   * Feed fresh per-browser subtree-RSS samples (MB, keyed by browser id) and mark for DRAINING any browser
   * whose memory has stayed above `thresholdMb` for the ENTIRE moving window (min over the window > threshold
   * — so a single spike never recycles). A drained browser stops taking new leases and closes once its last
   * context releases (existing recycle lifecycle); if it is already idle when it trips, it closes now. Never
   * touches active workflows. Returns the ids newly marked for recycling. Pure w.r.t. Playwright.
   */
  async applyMemorySamples(byId: Map<string, number>, thresholdMb: number, windowSize = 3): Promise<string[]> {
    if (!(thresholdMb > 0) || windowSize < 1) return [];
    const recycled: string[] = [];
    for (const record of [...this.browsers.values()]) {
      const sample = byId.get(record.id);
      if (sample === undefined) {
        record.memWindow = [];
        continue;
      }
      record.memWindow.push(sample);
      if (record.memWindow.length > windowSize) record.memWindow.shift();
      if (record.unhealthy || record.recycling) continue;
      if (record.memWindow.length >= windowSize && Math.min(...record.memWindow) > thresholdMb) {
        record.recycling = true;
        record.retireReason ??= "MEMORY_THRESHOLD";
        record.memWindow = [];
        recycled.push(record.id);
        if (record.activeContexts === 0) await this.closeBrowser(record.id, "MEMORY_THRESHOLD");
      }
    }
    return recycled;
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
      closeReasons: { ...this.closeReasonCounts },
      launchFailures: this.launchFailures,
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
