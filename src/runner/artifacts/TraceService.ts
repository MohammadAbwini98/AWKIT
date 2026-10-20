/**
 * Failure-path Playwright trace capture. Tracing is started once per browser context and each
 * step runs inside a trace *chunk*: failed steps save their chunk to
 * `<traceDir>/<stepId>-<timestamp>.zip`; successful steps discard theirs, so success runs write
 * nothing to disk. Active only when the engine provides a traces directory AND the mode allows
 * it (`AWKIT_TRACE_MODE`: `onFailure` (default) | `always` | `off`) — direct PlaywrightRunner
 * users (verify scripts) see zero overhead.
 *
 * Protected surfaces (awkit-trace-protected): a chunk records screenshots, DOM snapshots, typed field values and
 * response bodies of EVERY page in the context, so it must never hold a sign-in, CAPTCHA, MFA, OTP or passkey
 * surface. No chunk is opened for a protected-login or manual-handoff step, or while any page of the context fails
 * the shared protected-surface guard. While a chunk is open, every frame navigation and every new page in the
 * context is scanned; a protected verdict, or a protected-login handoff anywhere in the run, stops the recording at
 * once and discards the chunk. A chunk is saved only when its context still passes the guard, and a save that a
 * late scan contradicts is deleted. Every scan fails closed.
 *
 * Every method is best-effort: trace problems are logged and never mask the automation failure.
 * Concurrent isolated parallel branches share one context tracing session, so only one chunk can
 * be open at a time — overlapping steps simply skip tracing.
 */
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import { providerFromHost } from "../../security/ProtectedLoginDetector";
import { pageIsProtected, PROTECTED_SURFACE_SCAN_BUDGET_MS } from "../protectedSurfaceScan";
import { loadArtifactProfile, resolveArtifactSettings } from "./ArtifactProfile";

export type TraceMode = "off" | "onFailure" | "always";

export function loadTraceMode(): TraceMode {
  const raw = (process.env.AWKIT_TRACE_MODE ?? "").toLowerCase();
  if (raw === "off" || raw === "always") return raw;
  if (raw === "onfailure") return "onFailure";
  // Unset/unrecognized: defer to the Phase A9 artifact profile (default "balanced" → onFailure, so the
  // historical default is unchanged). AWKIT_TRACE_MODE, when set, always wins above.
  return resolveArtifactSettings(loadArtifactProfile()).traceMode;
}

/** One open chunk: its protected-surface verdicts and whether its recording has already been stopped. */
interface ChunkWatch {
  context: BrowserContext;
  tainted: boolean;
  stopped: boolean;
  discard?: Promise<void>;
  scans: Promise<void>[];
  dispose: () => void;
}

export class TraceService {
  private context?: BrowserContext;
  private tracingStarted = false;
  private chunkOpen = false;
  private watch?: ChunkWatch;

  constructor(
    private readonly traceDir: string | undefined,
    private readonly mode: TraceMode = loadTraceMode(),
    private readonly warn: (message: string) => void = (message) => console.warn(`[trace] ${message}`)
  ) {}

  get enabled(): boolean {
    return this.mode !== "off" && !!this.traceDir;
  }

  /** Start tracing on a (new) context — called at launch and after every mid-run browser swap. */
  async attach(context: BrowserContext): Promise<void> {
    if (!this.enabled) return;
    this.closeChunk();
    this.context = context;
    this.tracingStarted = false;
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
      this.tracingStarted = true;
    } catch (error) {
      this.warn(`could not start tracing: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    // `start` also opens a first chunk; discard it so nothing is recorded outside a step's own chunk.
    await context.tracing.stopChunk().catch(() => undefined);
  }

  /**
   * Open a chunk for one step. Returns false when tracing is unavailable, a chunk is open, the step is a
   * protected-login/handoff step (`protectedStep`, which also stops any open chunk), or a page of the context is (or
   * cannot be proven not to be) a protected surface — in those cases nothing is recorded at all.
   */
  async beginStep(options: { protectedStep?: boolean } = {}): Promise<boolean> {
    if (options.protectedStep === true) {
      this.markProtected();
      return false;
    }
    if (!this.enabled || !this.tracingStarted || this.chunkOpen || !this.context) return false;
    const context = this.context;
    if (await this.contextIsProtected(context)) return false;
    // Re-check: another executor may have opened a chunk, or the browser swapped, while the scan ran.
    if (this.chunkOpen || this.context !== context) return false;
    this.chunkOpen = true;
    const watch = this.watchContext(context);
    this.watch = watch;
    try {
      await context.tracing.startChunk();
      // A taint that raced the start may have stopped nothing yet; make sure the chunk is not recording.
      if (watch.tainted) await context.tracing.stopChunk().catch(() => undefined);
      return true;
    } catch (error) {
      if (this.watch === watch) this.closeChunk();
      this.warn(`could not start trace chunk: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** A protected surface is in play somewhere in the run: stop the open chunk's recording now and never save it. */
  markProtected(): void {
    if (this.chunkOpen && this.watch) this.taint(this.watch);
  }

  /**
   * Close the step's chunk. Saves a zip when the step failed (or mode is `always`) and the chunk never touched a
   * protected surface, and returns its path; otherwise discards. Never throws.
   */
  async endStep(stepId: string, failed: boolean): Promise<string | undefined> {
    const watch = this.watch;
    if (!this.chunkOpen || !watch) return undefined;
    const save = failed || this.mode === "always";
    try {
      if (!save) {
        await this.stopWithoutSaving(watch);
        return undefined;
      }
      await settle(watch, (w) => this.taint(w));
      if (!watch.tainted && (await this.contextIsProtected(watch.context))) this.taint(watch);
      if (watch.tainted) {
        await watch.discard;
        this.warn(`trace for step ${stepId} not kept: a protected surface was present`);
        return undefined;
      }
      await mkdir(this.traceDir!, { recursive: true });
      const safeStepId = stepId.replace(/[^\w.-]+/g, "_");
      const path = join(this.traceDir!, `${safeStepId}-${Date.now()}.zip`);
      watch.stopped = true;
      await watch.context.tracing.stopChunk({ path });
      // A protected surface that arrived between the last scan and the stop is still refused.
      await settle(watch, (w) => this.taint(w));
      if (watch.tainted || (await this.contextIsProtected(watch.context))) {
        await unlink(path).catch((error) => this.warn(`could not delete refused trace for step ${stepId}: ${error instanceof Error ? error.message : String(error)}`));
        this.warn(`trace for step ${stepId} not kept: a protected surface was present`);
        return undefined;
      }
      return path;
    } catch (error) {
      this.warn(`could not save trace for step ${stepId}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      if (this.watch === watch) this.closeChunk();
    }
  }

  private async stopWithoutSaving(watch: ChunkWatch): Promise<void> {
    if (watch.stopped) {
      await watch.discard;
      return;
    }
    watch.stopped = true;
    await watch.context.tracing.stopChunk();
  }

  /** Mark the chunk and stop its recording at once (discarding it); later saves are refused. */
  private taint(watch: ChunkWatch): void {
    watch.tainted = true;
    if (watch.stopped) return;
    watch.stopped = true;
    watch.discard = watch.context.tracing.stopChunk().then(
      () => undefined,
      () => undefined
    );
  }

  private async contextIsProtected(context: BrowserContext): Promise<boolean> {
    let pages: Page[];
    try {
      pages = context.pages();
    } catch {
      return true;
    }
    const verdicts = await Promise.all(pages.map((page) => pageIsProtected(page)));
    return verdicts.includes(true);
  }

  /** Scan every frame navigation and every new page in the context while the chunk is open. */
  private watchContext(context: BrowserContext): ChunkWatch {
    const watch: ChunkWatch = { context, tainted: false, stopped: false, scans: [], dispose: () => undefined };
    const disposers: Array<() => void> = [];
    // At most one scan in flight per page: a navigation during a scan only asks for one more pass afterwards, so a
    // page that never stops navigating cannot pile up concurrent full-page scans.
    const inFlight = new Map<Page, { frame: Frame | Page; again: boolean }>();
    const scanWhenLoaded = (page: Page, frame: Frame | Page): void => {
      const pending = inFlight.get(page);
      if (pending) {
        pending.frame = frame;
        pending.again = true;
        return;
      }
      const state = { frame, again: true };
      inFlight.set(page, state);
      const run = async (): Promise<void> => {
        while (state.again && !watch.tainted) {
          state.again = false;
          await state.frame.waitForLoadState("domcontentloaded", { timeout: PROTECTED_SURFACE_SCAN_BUDGET_MS }).catch(() => undefined);
          if (await pageIsProtected(page, { closedIsProtected: true })) this.taint(watch);
        }
        inFlight.delete(page);
      };
      watch.scans.push(run());
    };
    const watchPage = (page: Page): void => {
      const onNavigated = (frame: Frame): void => {
        // A known identity-provider host is protected before any document is scanned (it may be gone by then).
        if (isProviderUrl(frame.url())) this.taint(watch);
        scanWhenLoaded(page, frame);
      };
      page.on("framenavigated", onNavigated);
      disposers.push(() => page.off("framenavigated", onNavigated));
    };
    // A popup can finish its first load before this listener exists, so a new page is scanned once it has a document.
    const onPage = (page: Page): void => {
      watchPage(page);
      scanWhenLoaded(page, page);
    };
    try {
      for (const page of context.pages()) watchPage(page);
      context.on("page", onPage);
      disposers.push(() => context.off("page", onPage));
    } catch {
      this.taint(watch);
    }
    watch.dispose = () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          // A page that already closed has no listeners left to remove.
        }
      }
    };
    return watch;
  }

  private closeChunk(): void {
    this.watch?.dispose();
    this.watch = undefined;
    this.chunkOpen = false;
  }
}

function isProviderUrl(url: string): boolean {
  try {
    return providerFromHost(new URL(url).host) !== "unknown";
  } catch {
    return false;
  }
}

/** Upper bound for waiting on a chunk's scans; a page that keeps navigating must not hang the step. */
const SETTLE_BUDGET_MS = 3 * PROTECTED_SURFACE_SCAN_BUDGET_MS;

/**
 * Wait for every scan the watch has started, including ones started while waiting. Scans still running at the
 * deadline were never proven clean, so the chunk is tainted (fails closed).
 */
async function settle(watch: ChunkWatch, taint: (watch: ChunkWatch) => void): Promise<void> {
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  let seen = -1;
  while (seen !== watch.scans.length) {
    seen = watch.scans.length;
    const remaining = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = remaining > 0 && (await Promise.race([
      Promise.all(watch.scans).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), remaining);
      })
    ]).finally(() => clearTimeout(timer)));
    if (!settled) {
      taint(watch);
      return;
    }
  }
}
