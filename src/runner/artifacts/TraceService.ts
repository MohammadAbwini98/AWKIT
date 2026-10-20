/**
 * Failure-path Playwright trace capture. Each step is recorded in its OWN tracing session (started when the step
 * begins, stopped when it ends): failed steps save it to `<traceDir>/<stepId>-<timestamp>.zip`; successful steps
 * discard it, so success runs write nothing to the retained traces directory. Active only when the engine provides a
 * traces directory AND the mode allows it (`AWKIT_TRACE_MODE`: `onFailure` (default) | `always` | `off`) — direct
 * PlaywrightRunner users (verify scripts) see zero overhead.
 *
 * Protected surfaces (awkit-trace-protected, awkit-3gtj): a trace records screenshots, DOM snapshots, typed field
 * values and network bodies of EVERY page in the context, so it must never hold a sign-in, CAPTCHA, MFA, OTP or
 * passkey surface.
 *  - No session is started for a protected-login or manual-handoff step, or while any page of the context fails the
 *    shared protected-surface guard. Nothing is recorded between steps: Playwright's network recorder runs for a whole
 *    tracing session, not per chunk, so a session that outlived one step would carry an earlier step's protected
 *    page into a later step's trace.
 *  - While a session runs, every frame navigation and every new page in the context is scanned, and a mutation
 *    sentinel in every frame latches a protected field that appears even briefly with no navigation. A protected
 *    verdict, or a protected-login handoff anywhere in the run, stops the recording at once and discards it.
 *  - A discarded protected session's raw files (trace events, network log and the resources they name) are deleted
 *    from Playwright's temporary artifacts directory, which otherwise keeps them until the browser closes.
 *  - A session is saved only when its context still passes the guard, and a save that a late scan contradicts is
 *    deleted. Every scan fails closed.
 *
 * Every method is best-effort: trace problems are logged and never mask the automation failure.
 * Concurrent isolated parallel branches share one context, so only one session can be open at a time — overlapping
 * steps simply skip tracing.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import { providerFromHost } from "../../security/ProtectedLoginDetector";
import { watchProtectedWindow, type ProtectedWindowWatch } from "../../security/ProtectedSurfaceGuard";
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

/** One step's tracing session: its protected-surface verdicts and whether its recording has already been stopped. */
interface ChunkWatch {
  context: BrowserContext;
  /** The Playwright trace name of this session; its raw files in the artifacts directory start with it. */
  traceName: string;
  tainted: boolean;
  stopped: boolean;
  /** The one `tracing.stop` call of this session, once issued. */
  stopping?: Promise<void>;
  /** Set once a taint has scheduled the purge of this session's raw files. */
  purged: boolean;
  /** Settles once a tainted session is stopped and its raw files purged. */
  discard?: Promise<void>;
  scans: Promise<void>[];
  /** awkit-3gtj: one mutation-sentinel watch per page (non-strict: navigations are covered by the scans). */
  sentinels: Map<Page, Promise<ProtectedWindowWatch>>;
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

  /**
   * Bind tracing to a (new) context — called at launch and after every mid-run browser swap. Nothing is recorded
   * here: each step starts its own session in `beginStep`.
   */
  async attach(context: BrowserContext): Promise<void> {
    if (!this.enabled) return;
    this.closeChunk();
    this.context = context;
    this.tracingStarted = true;
  }

  /**
   * Start a session for one step. Returns false when tracing is unavailable, a session is open, the step is a
   * protected-login/handoff step (`protectedStep`, which also stops any open session), or a page of the context is
   * (or cannot be proven not to be) a protected surface — in those cases nothing is recorded at all.
   */
  async beginStep(options: { protectedStep?: boolean } = {}): Promise<boolean> {
    if (options.protectedStep === true) {
      this.markProtected();
      return false;
    }
    if (!this.enabled || !this.tracingStarted || this.chunkOpen || !this.context) return false;
    const context = this.context;
    if (await this.contextIsProtected(context)) return false;
    // Re-check: another executor may have opened a session, or the browser swapped, while the scan ran.
    if (this.chunkOpen || this.context !== context) return false;
    this.chunkOpen = true;
    const watch = this.watchContext(context);
    this.watch = watch;
    try {
      await Promise.all(watch.sentinels.values());
      await context.tracing.start({ name: watch.traceName, screenshots: true, snapshots: true });
      // A taint that raced the start may have stopped (and purged) nothing yet; stop and purge again.
      if (watch.tainted) {
        await watch.discard;
        await context.tracing.stop().catch(() => undefined);
        await this.purgeSession(watch.traceName);
      }
      return true;
    } catch (error) {
      await context.tracing.stop().catch(() => undefined);
      if (this.watch === watch) this.closeChunk();
      this.warn(`could not start trace session: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** A protected surface is in play somewhere in the run: stop the open session's recording now and never save it. */
  markProtected(): void {
    if (this.chunkOpen && this.watch) this.taint(this.watch);
  }

  /**
   * Close the step's session. Saves a zip when the step failed (or mode is `always`) and the session never touched a
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
      watch.stopping = watch.context.tracing.stop({ path });
      await watch.stopping;
      // A protected surface that arrived between the last scan and the stop — or came and went with no navigation,
      // which only the sentinels saw — is still refused.
      await settle(watch, (w) => this.taint(w));
      if ((await this.sentinelsSawProtected(watch)) || watch.tainted || (await this.contextIsProtected(watch.context))) {
        this.taint(watch);
        await unlink(path).catch((error) => this.warn(`could not delete refused trace for step ${stepId}: ${error instanceof Error ? error.message : String(error)}`));
        await watch.discard;
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

  /**
   * Discard the session. The sentinels' latches are read first (a page can silence their console signal, never the
   * latch), and scans already running (a navigation inside the step) get one scan budget to finish, so a protected
   * surface either saw still has the session's raw files purged before the step ends; no new scan starts.
   */
  private async stopWithoutSaving(watch: ChunkWatch): Promise<void> {
    if (!watch.stopped) {
      watch.stopped = true;
      watch.stopping = watch.context.tracing.stop();
    }
    if (await this.sentinelsSawProtected(watch)) this.taint(watch);
    watch.dispose();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(watch.scans),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PROTECTED_SURFACE_SCAN_BUDGET_MS);
      })
    ]).finally(() => clearTimeout(timer));
    await watch.stopping;
    await watch.discard;
  }

  /**
   * Mark the session, stop its recording at once and purge its raw files once stopped; later saves are refused. A
   * taint that arrives after the session already stopped (a scan that finished after a passing step ended) still
   * purges.
   */
  private taint(watch: ChunkWatch): void {
    watch.tainted = true;
    if (!watch.stopped) {
      watch.stopped = true;
      watch.stopping = watch.context.tracing.stop();
    }
    if (watch.purged) return;
    watch.purged = true;
    watch.discard = (watch.stopping ?? Promise.resolve()).catch(() => undefined).then(() => this.purgeSession(watch.traceName));
  }

  /**
   * awkit-3gtj: delete a discarded protected session's raw files from Playwright's temporary artifacts directory
   * (`<tmp>/playwright-artifacts-*`, where an unconfigured browser keeps its traces): every file named after the
   * session, and every resource (screencast frame, snapshot blob, network body) those files name. A later trace that
   * shares one of those resources with it records it without that resource — an accepted, fail-closed loss.
   */
  private async purgeSession(traceName: string): Promise<void> {
    try {
      const tmp = tmpdir();
      const artifactDirs = (await readdir(tmp)).filter((name) => name.startsWith("playwright-artifacts-"));
      for (const dirName of artifactDirs) {
        const dir = join(tmp, dirName);
        const own = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(`${traceName}.`) || name.startsWith(`${traceName}-`));
        if (own.length === 0) continue;
        const resources = new Set<string>();
        for (const name of own) collectResourceNames(await readFile(join(dir, name), "utf8").catch(() => ""), resources);
        // awkit-3gtj review F2: one failed delete never stops the rest, and the session's own files always go.
        const outcomes = await Promise.allSettled([
          ...[...resources].map((sha1) => rm(join(dir, "resources", sha1), { force: true })),
          ...own.map((name) => rm(join(dir, name), { force: true, recursive: true }))
        ]);
        const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
        if (failed > 0) this.warn(`could not delete ${failed} raw file(s) of a discarded protected trace session`);
        return;
      }
    } catch (error) {
      this.warn(`could not purge a discarded protected trace session: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  /** Read (and remove) every page's sentinel: true when one latched a protected field during the session. */
  private async sentinelsSawProtected(watch: ChunkWatch): Promise<boolean> {
    const sentinels = [...watch.sentinels.values()];
    watch.sentinels.clear();
    const verdicts = await Promise.all(sentinels.map((sentinel) => sentinel.then((s) => s.finish()).catch(() => ({ protected: false }))));
    return verdicts.some((verdict) => verdict.protected);
  }

  /** Scan every frame navigation and every new page in the context while the session is open. */
  private watchContext(context: BrowserContext): ChunkWatch {
    const watch: ChunkWatch = {
      context,
      traceName: `awkit-${randomUUID()}`,
      tainted: false,
      stopped: false,
      purged: false,
      scans: [],
      sentinels: new Map(),
      dispose: () => undefined
    };
    const disposers: Array<() => void> = [];
    const sentinelFor = (page: Page): void => {
      if (watch.sentinels.has(page)) return;
      const sentinel = watchProtectedWindow(page, { strict: false, onProtected: () => this.taint(watch) });
      watch.sentinels.set(page, sentinel);
    };
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
          // The navigated document lost its sentinel; arm the new one.
          else await watch.sentinels.get(page)?.then((sentinel) => sentinel.rearm()).catch(() => undefined);
        }
        inFlight.delete(page);
      };
      watch.scans.push(run());
    };
    const watchPage = (page: Page): void => {
      sentinelFor(page);
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
      // Disarm the sentinels that were not read; best-effort, nothing waits on it.
      for (const sentinel of watch.sentinels.values()) void sentinel.then((s) => s.finish()).catch(() => undefined);
      watch.sentinels.clear();
    };
    return watch;
  }

  private closeChunk(): void {
    this.watch?.dispose();
    this.watch = undefined;
    this.chunkOpen = false;
  }
}

/**
 * A Playwright trace resource name — a content hash with an optional extension, or a screencast frame
 * (`<page guid>-<epoch ms>.jpeg`) — never a path, `.`/`..` or a drive.
 */
const RESOURCE_NAME = /^(?:[0-9a-f]{40}(?:\.[A-Za-z0-9]{1,16})?|page@[0-9a-f]{1,64}-\d{1,16}\.jpeg)$/;

/**
 * awkit-3gtj review F2: collect only the resource names Playwright itself writes, read from its own event fields
 * (screencast frames, action attachments, snapshot resource overrides, network request and response bodies). A raw-
 * text scan would also match page markup — DOM attributes are serialized into frame snapshots — and let a page steer
 * or abort the purge.
 */
function collectResourceNames(text: string, into: Set<string>): void {
  const add = (value: unknown): void => {
    if (typeof value === "string" && RESOURCE_NAME.test(value)) into.add(value);
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "screencast-frame") add(event.sha1);
    for (const attachment of Array.isArray(event.attachments) ? event.attachments : []) add((attachment as { sha1?: unknown }).sha1);
    const snapshot = event.snapshot as
      | { resourceOverrides?: Array<{ sha1?: unknown }>; request?: { postData?: { _sha1?: unknown } }; response?: { content?: { _sha1?: unknown } } }
      | undefined;
    if (!snapshot || typeof snapshot !== "object") continue;
    if (event.type === "frame-snapshot") for (const override of Array.isArray(snapshot.resourceOverrides) ? snapshot.resourceOverrides : []) add(override?.sha1);
    if (event.type === "resource-snapshot") {
      add(snapshot.request?.postData?._sha1);
      add(snapshot.response?.content?._sha1);
    }
  }
}

function isProviderUrl(url: string): boolean {
  try {
    return providerFromHost(new URL(url).host) !== "unknown";
  } catch {
    return false;
  }
}

/** Upper bound for waiting on a session's scans; a page that keeps navigating must not hang the step. */
const SETTLE_BUDGET_MS = 3 * PROTECTED_SURFACE_SCAN_BUDGET_MS;

/**
 * Wait for every scan the watch has started, including ones started while waiting. Scans still running at the
 * deadline were never proven clean, so the session is tainted (fails closed).
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
