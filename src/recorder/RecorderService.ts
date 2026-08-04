import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { 
  RecordedAction, 
  RecordedUrl, 
  RecorderHandoffInfo, 
  AmbiguityState, 
  AmbiguityResolutionChoice, 
  AmbiguityResolutionPayload 
} from "./RecorderTypes";
import { getRecorderInitScriptContent } from "./recorderInitScript";
import { buildSmartWaits, type RecordedSignal } from "./smartWaitObservation";
import { detectRecorderProtectedLogin } from "../security/ProtectedLoginDetector";
import { buildChromiumHardeningArgs } from "../runner/ChromiumHardening";
import type { SessionCaptureService } from "../session/SessionCaptureService";
import type { SessionProfile } from "../session/SessionProfile";
import { normalizeOrigin } from "../session/sessionMatch";
import { createLocatorApprovalBinding, isPositionalCandidate, isPositionalLocator } from "../profiles/locatorApproval";
import type { FlowStep, LocatorCandidate } from "../profiles/FlowProfile";
import { LocatorFactory } from "../runner/LocatorFactory";
import { derivePopupAlias } from "../runner/runtime/PopupIdentityRegistry";
import {
  buildBrowserContextOptions,
  describeCertificateError,
  isCertificateError,
  CERTIFICATE_BYPASS_LOG_MESSAGE
} from "../security/browser/CertificateTrust";

/** On-disk shape of the recorder draft (an unsaved recording session's actions). */
interface RecorderDraft {
  version: 1;
  updatedAt: string;
  actions: RecordedAction[];
  /** Legacy field — the reusable URL list now lives in its own history file. Read for migration only. */
  urls?: RecordedUrl[];
}

/** Debounce window (ms) for writing the draft to disk during recording. */
const DRAFT_PERSIST_DEBOUNCE_MS = 400;

/** Query-string keys whose values are masked before a recorded URL is stored/shown. */
const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "password",
  "secret",
  "session",
  "auth",
  "key",
  "api_key"
]);

/** Skip consecutive identical URLs recorded within this window (ms) to avoid noisy duplicates. */
const URL_DEDUPE_WINDOW_MS = 1500;

/** Minimum think-time (ms) worth recording as a wait step — ignore normal UI-processing jitter. */
const WAIT_CAPTURE_MIN_MS = 500;
/** Cap a captured wait so long idle gaps don't bake an absurd delay into the flow. */
const WAIT_CAPTURE_MAX_MS = 60_000;
/** Cap on how many saved URLs are kept in the reusable history. */
const URL_HISTORY_LIMIT = 200;

/** On-disk shape of the persistent, reusable recorded-URL history (survives draft discard/restart). */
interface RecordedUrlHistory {
  version: 1;
  urls: RecordedUrl[];
}

/** Options accepted when starting a recording session. */
export interface StartRecordingOptions {
  executablePath?: string;
  /** When true, insert fixed-time wait steps for meaningful pauses between recorded actions. */
  captureWaitTime?: boolean;
  /**
   * When true (default), observe loaders/network/URL/data/toasts/enabled-transitions between
   * actions and attach condition-based Smart Waits (`afterWaits`) to the preceding action.
   */
  captureSmartWaits?: boolean;
  /**
   * When true, the Recorder does not auto-pause on a detected protected login / SSO / protected
   * popup (global Settings override). Never bypasses authentication — the user still logs in
   * manually; AWKIT simply keeps observing normal actions. Default false.
   */
  ignoreProtectedLoginDetection?: boolean;
  /** Async Activity Awareness tuning (adaptive Smart-Wait timeouts). */
  asyncAwareness?: {
    enabled?: boolean;
    adaptiveTimeouts?: boolean;
    minimumTimeoutMs?: number;
    maximumTimeoutMs?: number;
    loaderAppearanceGraceMs?: number;
  };
  /**
   * Certificate trust for this Recorder session, resolved from Settings by the caller
   * (`recorder.ipc`). When true the Recorder browser continues on untrusted/expired/self-signed/
   * mismatched HTTPS certificates. Omitted = validate (secure default).
   */
  ignoreHttpsErrors?: boolean;
}

export class RecorderService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private actions: RecordedAction[] = [];
  private isRecording = false;
  /** The page the last recorded action came from, used to detect tab/URL switches. */
  private lastActionPage: Page | null = null;
  /** Reusable, deduped URL history — persisted separately from the draft so it survives save/restart. */
  private recordedUrls: RecordedUrl[] = [];
  private urlSessionId = "";
  /** Whether the active session records think-time wait steps between actions (Task 1). */
  private captureWaitTime = false;
  /** Whether the active session observes condition-based Smart Waits between actions (Phase 2). */
  private captureSmartWaits = true;
  /** Async Activity Awareness tuning for adaptive Smart-Wait timeouts (applied in {@link attachSmartWaits}). */
  private asyncAwareness: { enabled: boolean; adaptiveTimeouts: boolean; minimumTimeoutMs: number; maximumTimeoutMs: number; loaderAppearanceGraceMs: number } = {
    enabled: true,
    adaptiveTimeouts: true,
    minimumTimeoutMs: 10_000,
    maximumTimeoutMs: 300_000,
    loaderAppearanceGraceMs: 1_500
  };
  /**
   * Certificate trust for the active session. Held on the instance (not just the start options) so
   * EVERY recorder browser path inherits it — initial launch, the post-handoff persistent-context
   * resume (Auto Secure Login / Reuse Session), and any relaunch. Reset to the secure default at the
   * start of each recording so a previous session can never leak its bypass into the next one.
   */
  private ignoreHttpsErrors = false;
  /** Raw page-side observation signals buffered during the session (bounded). */
  private signals: RecordedSignal[] = [];
  /** Timestamp (ms) of the last distinct recorded action, used to measure user think-time. */
  private lastActionAt = 0;
  /** Where the persistent URL history is written; set once by the main process. */
  private urlHistoryPath: string | null = null;
  private urlHistoryLoad: Promise<void> | null = null;
  /** Where the unsaved-recording draft is written; set once by the main process. */
  private draftPath: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** Memoized one-time load of any draft left over from a previous app session. */
  private draftLoad: Promise<void> | null = null;
  // ── Multi-Window / Popup tracking ──────────────────────────────────────────
  /** Auto-incrementing counter for popup alias assignment (popup-1, popup-2, …). */
  private popupCounter = 0;
  /** Active popup pages keyed by their assigned alias. */
  private popupPages = new Map<string, Page>();
  /** Exactly one asynchronous registration pipeline per popup page. */
  private popupRegistrations = new Map<Page, Promise<string>>();
  /** Direct Playwright `page.popup` attribution, populated even when the context event wins first. */
  private popupOpeners = new Map<Page, Page>();
  /** Last committed click per page; only the direct opener page may claim it. */
  private lastClickByPage = new Map<Page, { action: RecordedAction; at: number }>();
  /** Pages already carrying the direct causal popup listener. */
  private popupSources = new WeakSet<Page>();
  /** Non-secret instrumentation failure surfaced through Recorder status instead of swallowed. */
  private instrumentationError: string | undefined;
  // ── Protected login / popup manual handoff ───────────────────────────────────
  /** Injected real-Chrome session capture service (from the main process). */
  private sessionService: SessionCaptureService | null = null;
  /** Active protected-login handoff state (null when none). */
  private handoff: RecorderHandoffInfo | null = null;
  /** Active ambiguity resolution state (null when none). */
  private ambiguityState: AmbiguityState | null = null;
  /** Ephemeral authorized page for live review; never serialized or persisted. */
  private ambiguityPage: Page | null = null;
  /** The original recording target URL — the safe URL to resume recording at after capture. */
  private recordingTargetUrl = "";
  /** Bundled Chromium path (offline) so the post-handoff resume relaunch uses the same browser. */
  private resumeExecutablePath: string | undefined;
  /** Guards against re-entrant detection while a handoff is being started. */
  private detecting = false;
  // ── Protected-detection ignore controls (false-positive handling) ────────────
  /** Global Settings override for this session: never auto-pause on protected detection. */
  private ignoreProtectedDetectionGlobal = false;
  /** Session override set by "Ignore and continue recording" (cleared on each new session). */
  private ignoreProtectedDetectionSession = false;
  /** Detection keys (origin:reason) already ignored this session — loop guard so the same ignored
   *  detection never re-pauses or re-fires the notice. Bounded to one recorder session. */
  private ignoredDetectionKeys = new Set<string>();

  /** Prepend https:// when the user enters a bare host (Playwright requires a full URL). */
  private static normalizeUrl(raw: string): string {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return "";
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) || /^(about:|data:|file:)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  /**
   * Mask sensitive query-string values so secrets/tokens are never stored or shown, and return the
   * canonical URL form (so e.g. `example.com` and `https://example.com/` dedupe to one entry).
   */
  private static maskUrl(raw: string): string {
    try {
      const parsed = new URL(raw);
      for (const key of [...parsed.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          parsed.searchParams.set(key, "***");
        }
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  /** Record a navigated URL (masked + deduped) and enrich the title best-effort. */
  private captureUrl(page: Page, rawUrl: string): void {
    if (!this.isRecording) return;
    if (!rawUrl || rawUrl === "about:blank") return;
    if (/^(chrome-error|chrome|devtools|about|data|blob):/i.test(rawUrl)) return;

    const url = RecorderService.maskUrl(rawUrl);
    const source = this.recordedUrls.some((entry) => entry.sessionId === this.urlSessionId) ? "navigation" : "manual_url_entry";
    const record = this.upsertUrl(url, source, this.urlSessionId);
    if (!record) return;
    // Best-effort title (page may still be loading) — never blocks recording.
    page.title().then((title) => {
      if (title) {
        record.title = title;
        void this.persistUrlHistory();
      }
    }).catch(() => undefined);
  }

  /**
   * Insert or refresh a URL in the reusable, deduped history (newest-first). Returns the stored
   * record, or `null` when a same-URL entry was just touched within the dedupe window (so a burst
   * of identical navigations doesn't spam the list). The history is capped and persisted.
   */
  private upsertUrl(url: string, source: string, sessionId?: string): RecordedUrl | null {
    const existing = this.recordedUrls.find((entry) => entry.url === url);
    if (existing) {
      if (Date.now() - Date.parse(existing.timestamp) < URL_DEDUPE_WINDOW_MS) return null;
      existing.timestamp = new Date().toISOString();
      existing.source = source;
      if (sessionId) existing.sessionId = sessionId;
      // Move the refreshed entry to the front so the reusable list stays newest-first.
      this.recordedUrls = [existing, ...this.recordedUrls.filter((entry) => entry !== existing)];
      void this.persistUrlHistory();
      return existing;
    }

    const record: RecordedUrl = {
      id: randomUUID(),
      url,
      timestamp: new Date().toISOString(),
      source,
      sessionId
    };
    this.recordedUrls = [record, ...this.recordedUrls].slice(0, URL_HISTORY_LIMIT);
    void this.persistUrlHistory();
    return record;
  }

  /**
   * Save a URL the user typed into the Recorder Controls (without necessarily recording). Normalized,
   * masked, and deduped into the reusable history so it can be clicked to refill the field later.
   */
  public async saveUrl(rawUrl: string): Promise<RecordedUrl[]> {
    await this.ensureUrlHistoryLoaded();
    const normalized = RecorderService.normalizeUrl(rawUrl);
    if (!normalized) return this.recordedUrls;
    this.upsertUrl(RecorderService.maskUrl(normalized), "manual_url_entry", this.isRecording ? this.urlSessionId : undefined);
    // Await the write so the history is durable before the IPC call resolves.
    await this.persistUrlHistory();
    return this.recordedUrls;
  }

  /** Attach main-frame navigation capture to a page (initial page + any opened tab). */
  private attachUrlCapture(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.captureUrl(page, frame.url());
    });
  }

  public getUrls(): RecordedUrl[] {
    return this.recordedUrls;
  }

  // ── Draft persistence ──────────────────────────────────────────────────────
  // A recording session (actions + URLs) is kept in memory. Without persistence it is lost when
  // the app closes before the user saves it as a flow. We mirror the session to a small JSON draft
  // under the runtime data folder so an unsaved recording survives a restart and reloads on the
  // Recorder page. The draft is cleared when a new recording starts, on cancel, and after save.

  /** Configure where the draft is written. Called once by the main process at startup. */
  public configureDraftStorage(path: string): void {
    this.draftPath = path;
  }

  /** Debounced write of the current in-memory session to the draft file. */
  private scheduleDraftPersist(): void {
    if (!this.draftPath) return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      void this.persistDraft();
    }, DRAFT_PERSIST_DEBOUNCE_MS);
  }

  private async persistDraft(): Promise<void> {
    if (!this.draftPath) return;
    const draft: RecorderDraft = {
      version: 1,
      updatedAt: new Date().toISOString(),
      actions: this.actions
    };
    try {
      await mkdir(dirname(this.draftPath), { recursive: true });
      await writeFile(this.draftPath, JSON.stringify(draft), "utf8");
    } catch {
      /* best-effort: never let draft I/O break recording */
    }
  }

  // ── Reusable URL history (Task 6) ────────────────────────────────────────────
  // The recorded-URL list is a reusable history that survives saving/cancelling a recording and an
  // app restart, so users can click a saved URL to refill the Recorder Controls field. It is deduped
  // by (masked) URL and stored separately from the transient recording draft.

  /** Configure where the reusable URL history is written. Called once by the main process. */
  public configureUrlStorage(path: string): void {
    this.urlHistoryPath = path;
  }

  /** Load the persisted URL history once (best-effort). Legacy draft URLs migrate on first load. */
  public ensureUrlHistoryLoaded(): Promise<void> {
    if (!this.urlHistoryLoad) {
      this.urlHistoryLoad = (async () => {
        if (!this.urlHistoryPath) return;
        try {
          const raw = await readFile(this.urlHistoryPath, "utf8");
          const parsed = JSON.parse(raw) as Partial<RecordedUrlHistory>;
          if (Array.isArray(parsed.urls)) this.recordedUrls = parsed.urls as RecordedUrl[];
        } catch {
          // No history file yet — try migrating any URLs left in a legacy draft, then persist.
          await this.migrateLegacyDraftUrls();
        }
      })();
    }
    return this.urlHistoryLoad;
  }

  /** One-time migration: pull URLs out of an older draft file into the new history store. */
  private async migrateLegacyDraftUrls(): Promise<void> {
    if (!this.draftPath || this.recordedUrls.length > 0) return;
    try {
      const raw = await readFile(this.draftPath, "utf8");
      const draft = JSON.parse(raw) as Partial<RecorderDraft>;
      if (Array.isArray(draft.urls) && draft.urls.length) {
        this.recordedUrls = (draft.urls as RecordedUrl[]).slice(0, URL_HISTORY_LIMIT);
        await this.persistUrlHistory();
      }
    } catch {
      /* nothing to migrate */
    }
  }

  private async persistUrlHistory(): Promise<void> {
    if (!this.urlHistoryPath) return;
    const payload: RecordedUrlHistory = { version: 1, urls: this.recordedUrls };
    try {
      await mkdir(dirname(this.urlHistoryPath), { recursive: true });
      await writeFile(this.urlHistoryPath, JSON.stringify(payload), "utf8");
    } catch {
      /* best-effort: never let URL I/O break recording */
    }
  }

  /**
   * Load a leftover draft from a previous app session into memory, once. Skips when a recording is
   * active or the session already has data (so it never clobbers a live session).
   */
  public ensureDraftLoaded(): Promise<void> {
    if (!this.draftLoad) {
      this.draftLoad = (async () => {
        if (!this.draftPath || this.isRecording || this.actions.length > 0) return;
        try {
          const raw = await readFile(this.draftPath, "utf8");
          const draft = JSON.parse(raw) as Partial<RecorderDraft>;
          if (Array.isArray(draft.actions)) this.actions = draft.actions as RecordedAction[];
        } catch {
          /* no draft / unreadable → nothing to restore */
        }
      })();
    }
    return this.draftLoad;
  }

  /**
   * Clear the in-memory recording (actions) and delete the draft file (after a save, or an explicit
   * discard). The reusable URL history is intentionally kept so saved URLs remain available for reuse.
   */
  public async discardDraft(): Promise<void> {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    this.actions = [];
    this.ambiguityState = null;
    this.ambiguityPage = null;
    this.draftLoad = Promise.resolve(); // don't re-restore the just-cleared draft
    if (this.draftPath) {
      await rm(this.draftPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Close the live automation browser/context. Handles both a normal `Browser` and a
   * `launchPersistentContext` (used when resuming after a secure-session handoff, where we own the
   * context but not a separate browser handle). Best-effort; never throws.
   */
  private async closeBrowser(): Promise<void> {
    try {
      if (this.context) await this.context.close();
    } catch {
      /* ignore */
    }
    try {
      if (this.browser) await this.browser.close();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /**
   * End the session when the recorded browser goes away WITHOUT the app asking it to — the user
   * closed the tab or the window, or the process was killed.
   *
   * Without this, `isRecording` stays true forever. The Recorder page polls `getStatus()` on an
   * interval, so it keeps reporting "Recording" and keeps Start, the Target URL field and both
   * capture switches disabled — the operator is stranded in a session whose browser no longer
   * exists, with Cancel as the only way out.
   *
   * All four signals are wired because none implies the others:
   *
   * - `page.close` — the recorded tab went away while the browser lives.
   * - `page.crash` — the tab's RENDERER died. Measured: the Page object stays alive and
   *   `page.isClosed()` is still false, so neither `close` nor `disconnected` fires. Without this the
   *   recorder sits in Recording forever behind a crashed tab, which is the case's own wording
   *   ("browser closes **or crashes**").
   * - `browser.disconnected` — a normal launch died or its process was killed.
   * - `context.close` — the persistent-context resume path, where `this.browser` is deliberately null.
   *
   * The recorded actions and the draft are PRESERVED. That is the whole difference between this path
   * and `cancelRecording`: an unexpected death must not destroy what the user recorded.
   */
  private attachLivenessWatch(browser: Browser | null, context: BrowserContext | null, page: Page): void {
    const onUnexpectedDeath = (): void => {
      // Every SUPPORTED teardown (stop, cancel, handoff) sets isRecording=false *before* closing
      // anything, so this guard is what makes the handler fire only on an unexpected death.
      if (!this.isRecording) return;
      // Ignore a handle belonging to a session we have already replaced — the resume path relaunches
      // a second browser, and its predecessor's listeners outlive it.
      const isCurrent = this.page === page || (browser !== null && this.browser === browser) || (context !== null && this.context === context);
      if (!isCurrent) return;

      this.isRecording = false;
      this.lastActionPage = null;
      this.popupPages.clear();
      // Best-effort, and deliberately not awaited: this runs from an event handler.
      void this.persistDraft().catch(() => undefined);
      void this.closeBrowser().catch(() => undefined);
    };

    page.on("close", onUnexpectedDeath);
    page.on("crash", onUnexpectedDeath);
    browser?.on("disconnected", onUnexpectedDeath);
    context?.on("close", onUnexpectedDeath);
  }

  /** Tear down the browser and reset state so a failed start never leaves us "in progress". */
  private async cleanup(): Promise<void> {
    this.isRecording = false;
    this.lastActionPage = null;
    this.popupCounter = 0;
    this.popupPages.clear();
    this.popupRegistrations.clear();
    this.popupOpeners.clear();
    this.lastClickByPage.clear();
    this.popupSources = new WeakSet<Page>();
    this.instrumentationError = undefined;
    await this.closeBrowser();
  }

  public async startRecording(url: string, options: StartRecordingOptions = {}): Promise<void> {
    if (this.isRecording) {
      throw new Error("Recording is already in progress.");
    }

    // The reusable URL history must be loaded before we start appending this session's URLs.
    await this.ensureUrlHistoryLoaded();

    const target = RecorderService.normalizeUrl(url);
    // Refuse a blank target BEFORE any state is mutated or a browser is launched. `normalizeUrl`
    // returns "" for blank input, and the start path went on to open a browser and enter the
    // Recording state anyway — leaving a live session pointed at nothing, with the Target URL field
    // locked (it disables while recording), so the only way out was Cancel. The Start button is not
    // gated on a non-empty URL (that guard sits on Save URL), so this is the only place to catch it.
    if (!target) {
      throw new Error("Enter a target URL before starting a recording.");
    }

    this.actions = [];
    this.ambiguityState = null;
    this.ambiguityPage = null;
    this.urlSessionId = randomUUID();
    this.isRecording = true;
    this.lastActionPage = null;
    this.popupCounter = 0;
    this.popupPages = new Map<string, Page>();
    this.popupRegistrations = new Map<Page, Promise<string>>();
    this.popupOpeners = new Map<Page, Page>();
    this.lastClickByPage = new Map<Page, { action: RecordedAction; at: number }>();
    this.popupSources = new WeakSet<Page>();
    this.instrumentationError = undefined;
    this.captureWaitTime = options.captureWaitTime ?? false;
    this.captureSmartWaits = options.captureSmartWaits ?? true;
    this.asyncAwareness = {
      enabled: options.asyncAwareness?.enabled ?? true,
      adaptiveTimeouts: options.asyncAwareness?.adaptiveTimeouts ?? true,
      minimumTimeoutMs: options.asyncAwareness?.minimumTimeoutMs ?? 10_000,
      maximumTimeoutMs: options.asyncAwareness?.maximumTimeoutMs ?? 300_000,
      loaderAppearanceGraceMs: options.asyncAwareness?.loaderAppearanceGraceMs ?? 1_500
    };
    // Reset to the secure default first, then apply this session's resolved value, so a prior
    // session's bypass can never leak into the next recording.
    this.ignoreHttpsErrors = options.ignoreHttpsErrors ?? false;
    this.signals = [];
    this.lastActionAt = 0;
    // Protected-login handoff bookkeeping: remember the safe resume URL + offline browser path.
    this.recordingTargetUrl = target;
    this.resumeExecutablePath = options.executablePath;
    this.handoff = null;
    this.detecting = false;
    // Protected-detection ignore controls: apply the global Settings value for this session and
    // reset the session override + loop-guard keys (a new recording never inherits a prior override).
    this.ignoreProtectedDetectionGlobal = options.ignoreProtectedLoginDetection ?? false;
    this.ignoreProtectedDetectionSession = false;
    this.ignoredDetectionKeys = new Set<string>();
    // A new recording replaces any leftover draft; block a pending restore from clobbering it.
    this.draftLoad = Promise.resolve();
    this.scheduleDraftPersist();

    try {
    // In packaged/offline mode the caller passes the bundled Chromium path so the
    // recorder never attempts to download or locate a globally installed browser.
    // buildChromiumHardeningArgs: no-egress hardening for the AWKIT-owned recorder browser
    // (never applied to the user's real Chrome in SessionCaptureService).
    this.browser = await chromium.launch({
      headless: false,
      executablePath: options.executablePath,
      args: buildChromiumHardeningArgs()
    });
    // Certificate trust is applied at CONTEXT creation, BEFORE any page exists or navigates below —
    // never by automating Chromium's interstitial ("Advanced" / "Proceed" / the hidden bypass phrase).
    this.context = await this.browser.newContext(
      buildBrowserContextOptions({}, { ignoreHttpsErrors: this.ignoreHttpsErrors })
    );
    this.logCertificateTrustBypass();
    this.page = await this.context.newPage();

    // Capture URLs visited during recording (initial page + any tab the site opens).
    this.attachUrlCapture(this.page);
    // Watch the main page for protected login / MFA / OTP / CAPTCHA / approval surfaces.
    this.attachProtectedDetection(this.page, "main");
    // End the session if the browser dies underneath it instead of staying stuck in Recording.
    this.attachLivenessWatch(this.browser, this.context, this.page);

    // Wire popup handling + capture bindings + the init script onto the context.
    await this.wireContext(this.context);

    this.lastActionPage = this.page;
    if (target) {
      await this.page.goto(target);
      this.actions.push({
        id: randomUUID(),
        type: "goto",
        name: `Navigate to ${target}`,
        valueSource: { type: "static", value: target }
      });
      // Start the think-time clock from the initial navigation so a wait before the first
      // interaction is captured too (only when wait capture is enabled).
      this.lastActionAt = Date.now();
    }
    } catch (error) {
      // Roll back so the recorder isn't stuck "Recording is already in progress".
      await this.cleanup();
      // A certificate-trust rejection gets actionable guidance pointing at the Settings toggle. Every
      // other failure (DNS, refused, timeout) is rethrown untouched — and the bypass is NEVER enabled
      // automatically in response to this error.
      if (!this.ignoreHttpsErrors && isCertificateError(error)) {
        throw new Error(describeCertificateError(error, this.ignoreHttpsErrors));
      }
      throw error;
    }
  }

  /**
   * Wire popup/new-window handling, the action + Smart-Wait signal bindings, and the injected
   * capture/init script onto a browser context. Shared by the initial recording launch and the
   * post-handoff resume (persistent-context) relaunch so both behave identically.
   */
  private async wireContext(context: BrowserContext): Promise<void> {
    // ── Popup / new-window handler ──────────────────────────────────────────
    // When the recorded site opens a new window/tab, assign it an alias (popup-1, popup-2, …),
    // inject the locator capture script, attach URL capture + protected detection, and optionally
    // correlate it with the last click so the opener action is marked `opensPopup = true`.
    context.on("page", (opened) => {
      void this.registerPopup(opened).catch((error) => this.noteInstrumentationError(error));
    });

    await context.exposeBinding("__awtkit_recordAction", async (source, action: Omit<RecordedAction, "id">) => {
      // A popup may emit its first interaction immediately after navigation. Await the one shared
      // registration pipeline so the action can never be mis-tagged as `main`.
      await this.popupRegistrations.get(source.page)?.catch((error) => this.noteInstrumentationError(error));
      this.recordActionFromPage(source.page, action, source.frame);
    });

    // Buffer raw Smart Wait observation signals (loader/network/url/rows/toast/enabled). Only safe
    // metadata is stored (method + URL path, selectors, short text) — never headers/bodies/secrets.
    await context.exposeBinding("__awtkit_recordSignal", (_source, s: RecordedSignal) => {
      if (!this.isRecording || !this.captureSmartWaits) return;
      this.signals.push(s);
      const cap = 2000;
      if (this.signals.length > cap) this.signals.splice(0, this.signals.length - cap);
    });

    // Inject the shared capture script. It generates ranked, uniqueness-validated
    // locators in the page DOM (semantic first; utility-class selectors never) so the
    // recorder saves Playwright-safe locators instead of generic CSS class selectors.
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    for (const page of context.pages()) this.attachPopupSource(page);
  }

  /** Attach the strongest causal popup signal to each page exactly once. */
  private attachPopupSource(page: Page): void {
    if (this.popupSources.has(page)) return;
    this.popupSources.add(page);
    page.on("popup", (opened) => {
      this.popupOpeners.set(opened, page);
      void this.registerPopup(opened, page).catch((error) => this.noteInstrumentationError(error));
    });
  }

  /** Origin + pathname only: stable enough for identity/replay and structurally query/fragment-free. */
  private static safePopupUrl(raw: string): URL | undefined {
    if (!raw || raw === "about:blank") return undefined;
    try {
      const parsed = new URL(raw);
      if (["about:", "data:", "blob:", "chrome:", "devtools:"].includes(parsed.protocol)) return undefined;
      return new URL(parsed.pathname || "/", parsed.origin);
    } catch {
      return undefined;
    }
  }

  /** Wait briefly for an about:blank popup's first identity-bearing main-frame navigation. */
  private async popupIdentityUrl(page: Page): Promise<URL | undefined> {
    const immediate = RecorderService.safePopupUrl(page.url());
    if (immediate) return immediate;
    return await new Promise<URL | undefined>((resolve) => {
      let settled = false;
      const finish = (value?: URL): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        page.off("framenavigated", onNavigated);
        page.off("close", onClose);
        resolve(value);
      };
      const onNavigated = (frame: Frame): void => {
        if (frame !== page.mainFrame()) return;
        const value = RecorderService.safePopupUrl(page.url());
        if (value) finish(value);
      };
      const onClose = (): void => finish();
      const timer = setTimeout(() => finish(), 2_000);
      page.on("framenavigated", onNavigated);
      page.on("close", onClose);
    });
  }

  /** Register, instrument, attribute, and close-track one popup through one deduplicated pipeline. */
  private registerPopup(opened: Page, opener?: Page): Promise<string> {
    if (opener) this.popupOpeners.set(opened, opener);
    const existing = this.popupRegistrations.get(opened);
    if (existing) return existing;

    const registration = (async (): Promise<string> => {
      this.attachUrlCapture(opened);
      this.attachPopupSource(opened);
      const identityUrl = await this.popupIdentityUrl(opened);
      // Identity-derived alias first; arrival order only as the documented last-resort fallback.
      // Two live popups CAN legitimately share one origin+path — falling back keeps both pages
      // registered and correctly attributed instead of leaving the loser tagged as `main`.
      let alias = identityUrl ? derivePopupAlias(identityUrl) : `popup-${++this.popupCounter}`;
      const stillHeld = (candidate: string): boolean => {
        const holder = this.popupPages.get(candidate);
        return !!holder && holder !== opened && !holder.isClosed();
      };
      if (stillHeld(alias)) {
        const base = alias;
        do {
          alias = `${base}#${++this.popupCounter}`;
        } while (stillHeld(alias));
      }
      this.popupPages.set(alias, opened);
      this.attachProtectedDetection(opened, alias);
      if (identityUrl) this.captureUrl(opened, identityUrl.toString());

      // Context init scripts already cover future popup documents. Verify the marker after the
      // first meaningful navigation and use an idempotent live fallback for unusual blank-document
      // lifecycles; any failure becomes visible in Recorder status.
      if (!opened.isClosed()) {
        const installed = await opened.evaluate(() => Boolean((window as unknown as { __awtkitCaptureInstalled?: boolean }).__awtkitCaptureInstalled)).catch(() => false);
        if (!installed) await opened.evaluate(getRecorderInitScriptContent());
      }

      // Let an action binding already in flight commit its click before causal attribution.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const causalOpener = this.popupOpeners.get(opened);
      const click = causalOpener ? this.lastClickByPage.get(causalOpener) : undefined;
      if (click && Date.now() - click.at <= 3_000) {
        click.action.opensPopup = true;
        click.action.popupExpectation = {
          popupAlias: alias,
          urlContains: identityUrl?.toString(),
          waitUntil: "domcontentloaded"
        };
      }

      opened.on("close", () => {
        if (this.popupPages.get(alias) === opened) this.popupPages.delete(alias);
        this.popupOpeners.delete(opened);
        this.popupRegistrations.delete(opened);
        if (!this.isRecording) return;
        this.actions.push({
          id: randomUUID(),
          type: "closePopup",
          name: `Popup closed: ${alias}`,
          pageAlias: alias,
          config: { popupAlias: alias }
        });
        this.scheduleDraftPersist();
      });
      this.scheduleDraftPersist();
      return alias;
    })();
    this.popupRegistrations.set(opened, registration);
    return registration;
  }

  private noteInstrumentationError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.instrumentationError = `Popup recording could not be initialized: ${message}`;
  }

  // ── Protected login / popup manual handoff ───────────────────────────────────

  /** Inject the running session-capture service (real Chrome) from the main process. */
  public configureSessionCapture(service: SessionCaptureService): void {
    this.sessionService = service;
  }

  /** Current protected-login handoff state (null when none is/was active this session). */
  public getHandoff(): RecorderHandoffInfo | null {
    return this.handoff;
  }

  /**
   * Watch a page for protected login / MFA / OTP / CAPTCHA / passkey / approval surfaces on every
   * load/navigation. On the first detection (while recording, no active handoff) it pauses the
   * recorder and begins a manual Chrome handoff. Detection only reads booleans + a bounded text
   * snippet — never secrets.
   */
  private attachProtectedDetection(page: Page, alias: string): void {
    const run = () => {
      void this.detectAndMaybeHandoff(page, alias);
    };
    page.on("load", run);
    page.on("domcontentloaded", run);
  }

  /** Stable, secret-free key for a detection so the same ignored one never re-pauses this session. */
  private detectionKeyFor(url: string, reason: string): string {
    return `${normalizeOrigin(RecorderService.maskUrl(url)) ?? ""}:${reason}`;
  }

  private async detectAndMaybeHandoff(page: Page, alias: string): Promise<void> {
    if (!this.isRecording || this.handoff?.active || this.detecting) return;
    this.detecting = true;
    try {
      const detection = await detectRecorderProtectedLogin(page);
      if (!detection.detected) return;
      // Low-confidence signals (e.g. a page that merely contains "single sign-on" text) are false
      // positives — keep recording, never pause. Only `pause` recommendations reach the handoff.
      if (detection.recommendedAction !== "pause") return;

      const key = this.detectionKeyFor(detection.url, detection.reason);
      // Ignore controls (precedence: session override → global Settings → already-ignored key).
      if (
        this.ignoreProtectedDetectionSession ||
        this.ignoreProtectedDetectionGlobal ||
        this.ignoredDetectionKeys.has(key)
      ) {
        // Record the key so we don't reconsider it, and continue recording without pausing.
        this.ignoredDetectionKeys.add(key);
        return;
      }

      await this.beginHandoff(page, alias, detection.url, detection.reason, detection.signals, detection.confidence, key);
    } catch {
      /* page not ready / navigated away — ignore, we'll re-check on the next load */
    } finally {
      this.detecting = false;
    }
  }

  /**
   * Enter the protected-login handoff: stop recording new actions, preserve the draft, store safe
   * handoff metadata, and leave the automation browser open but inert so a false positive can resume
   * in place. Never automates the protected page and never captures passwords/OTPs/CAPTCHA
   * values/cookies/tokens. The browser closes only if the user chooses the real-browser handoff.
   */
  private async beginHandoff(
    page: Page,
    alias: string,
    detectedRawUrl: string,
    reason: string,
    signals: string[],
    confidence?: "low" | "medium" | "high",
    detectionKey?: string
  ): Promise<void> {
    if (this.handoff?.active) return;
    // Pause: stop capturing user actions immediately (bindings/popup handlers early-return while
    // `isRecording` is false). The automation browser is left OPEN — not automated, just paused — so
    // "Ignore and continue recording" can resume on the exact same page/context if this was a false
    // positive. It is closed only when the user chooses manual handoff ("Continue using normal
    // browser") or cancels. Nothing on the protected page is ever recorded (guards above).
    this.isRecording = false;
    // Preserve the current recorder draft before showing the handoff.
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();

    const detectedUrl = RecorderService.maskUrl(detectedRawUrl || page.url());
    const origin = normalizeOrigin(detectedUrl) ?? "";
    this.handoff = {
      active: true,
      phase: "detected",
      sourceAlias: alias,
      detectedUrl,
      origin,
      reason,
      confidence,
      detectionKey: detectionKey ?? this.detectionKeyFor(detectedRawUrl || detectedUrl, reason),
      signals,
      timestamp: new Date().toISOString(),
      draftId: this.urlSessionId || undefined,
      resumeUrl: this.recordingTargetUrl || detectedUrl,
      message:
        "Protected login or protected popup detected. AWKIT paused the recorder because this page " +
        "appears to require a secure manual action (login, MFA, OTP, CAPTCHA, digital signature, or " +
        "external approval). For your safety, AWKIT will not automate this step. Choose " +
        '"Ignore and continue recording" if this is a false positive, or "Continue using normal ' +
        'browser" to finish a real login manually in Chrome, then "Capture Session & Resume".'
    };
  }

  /**
   * Session-level "Ignore and continue recording": treat the active protected detection as a false
   * positive and resume the SAME recorder session on the same page/context. Never reloads the page,
   * never creates a new context, never discards recorded actions, and never enables the global
   * Settings option. Authentication/security steps are still the user's responsibility.
   */
  public ignoreCurrentProtectedDetection(): { isRecording: boolean; actionCount: number; protectedDetectionIgnored: boolean } {
    if (!this.handoff || this.handoff.phase !== "detected") {
      throw new Error("No protected-login detection is waiting to be ignored.");
    }
    if (!this.context || !this.page) {
      throw new Error("The recording page is no longer available to resume.");
    }
    // Remember this detection so it never re-pauses, and suppress further protected pauses this
    // session (a session-level override, per the configuration precedence).
    if (this.handoff.detectionKey) this.ignoredDetectionKeys.add(this.handoff.detectionKey);
    this.ignoreProtectedDetectionSession = true;
    // Dismiss the handoff and resume capture on the live page (bindings are still attached).
    this.handoff = null;
    this.isRecording = true;
    this.lastActionAt = Date.now();
    this.scheduleDraftPersist();
    return this.getStatus();
  }

  /**
   * Open the user's real, installed Chrome (via the session-capture service) at the detected
   * protected URL, using an app-owned, scoped profile directory (never the user's personal Chrome
   * profile). The user completes the login/approval manually there.
   */
  public async continueWithNormalBrowser(): Promise<RecorderHandoffInfo> {
    if (!this.handoff || this.handoff.phase === "error") {
      throw new Error("No protected-login handoff is active.");
    }
    if (!this.sessionService) {
      throw new Error("Session capture is unavailable (no browser service configured).");
    }
    // Now that the user has chosen manual handoff, close the paused automation browser — we never
    // automate the protected page, and its profile must be free before the real Chrome opens.
    this.isRecording = false;
    await this.closeBrowser();
    this.lastActionPage = null;
    this.popupPages.clear();
    try {
      const name = `RecorderLogin-${new Date().toISOString().slice(0, 10)}`;
      const status = await this.sessionService.startCapture(name, this.handoff.detectedUrl, "manualChromeHandoff");
      if (!status.sessionId) throw new Error("Session capture did not start.");
      this.handoff = {
        ...this.handoff,
        phase: "capturingSession",
        sessionId: status.sessionId,
        sessionName: name,
        message:
          "Chrome is open at the protected page. Complete the login, MFA, OTP, CAPTCHA, signature, or " +
          'approval manually, then return here and click "Capture Session & Resume".'
      };
      return this.handoff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handoff = { ...this.handoff, phase: "error", error: message, message: `Could not open Chrome: ${message}` };
      throw error;
    }
  }

  /**
   * After the user finishes the manual login/approval in Chrome: validate the captured session,
   * (optionally) name it, insert the `Auto Secure Login` + `Reuse Session` nodes near the start of
   * the recorded flow, then relaunch Playwright on the saved session and resume recording.
   */
  public async captureSessionAndResume(sessionName?: string): Promise<RecorderHandoffInfo> {
    if (!this.handoff || this.handoff.phase !== "capturingSession") {
      throw new Error("No session capture is in progress.");
    }
    if (!this.sessionService) {
      throw new Error("Session capture is unavailable (no browser service configured).");
    }
    const sessionId = this.handoff.sessionId;
    if (!sessionId) {
      throw new Error("No captured session to save.");
    }
    try {
      // Close the manual Chrome window so its profile directory is unlocked for Playwright reuse.
      this.sessionService.stopCapture();
      await RecorderService.delay(900);

      const profile = await this.sessionService.getById(sessionId);
      if (!profile) throw new Error("The captured session could not be found.");
      if (!this.sessionService.hasCapturedData(sessionId)) {
        throw new Error("No authenticated session was detected. Complete the login in Chrome, then try again.");
      }

      const finalName = (sessionName ?? "").trim();
      if (finalName) {
        await this.sessionService.rename(sessionId, finalName);
        this.handoff.sessionName = finalName;
      }

      // Insert the secure-session nodes (deduped) near the start of the recorded flow.
      const resumeUrl = this.handoff.resumeUrl || profile.targetUrl || this.handoff.detectedUrl;
      this.insertSecureSessionNodes(sessionId, resumeUrl);

      this.handoff = { ...this.handoff, phase: "sessionCaptured", message: "Session captured. Resuming the recorder…" };

      // Relaunch Playwright on the saved session and resume recording.
      await this.resumeAfterHandoff(profile, resumeUrl);
      return this.handoff!;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handoff = { ...this.handoff, phase: "error", error: message, message };
      throw error;
    }
  }

  /**
   * Insert `Auto Secure Login` + `Reuse Session` nodes at the front of the recorded actions (before
   * the recorded business steps), linking the saved session id to `Reuse Session`. Idempotent: if the
   * same session's nodes already exist, nothing is added.
   */
  private insertSecureSessionNodes(sessionId: string, targetUrl: string): void {
    const already = this.actions.some(
      (action) => action.type === "reuseSession" && action.config?.reuseSessionId === sessionId
    );
    if (already) return;

    const reuse: RecordedAction = {
      id: randomUUID(),
      type: "reuseSession",
      name: "Reuse Session",
      config: { reuseSessionMode: "selected", reuseSessionId: sessionId }
    };
    const autoLogin: RecordedAction = {
      id: randomUUID(),
      type: "autoSecureLogin",
      name: "Auto Secure Login",
      valueSource: { type: "static", value: targetUrl }
    };
    // Prepend so the flow becomes: Start → Auto Secure Login → Reuse Session → recorded actions → End.
    this.actions.unshift(reuse);
    this.actions.unshift(autoLogin);
    this.scheduleDraftPersist();
  }

  /**
   * Relaunch a Playwright browser bound to the captured session's profile directory (persistent
   * context = same cookies/localStorage the user just logged in with), navigate to the safe resume
   * URL, and resume recording. The user should not need to log in again.
   */
  private async resumeAfterHandoff(profile: SessionProfile, resumeUrl: string): Promise<void> {
    // Same certificate-trust decision as the initial launch (held on the instance), applied before the
    // resume navigation below. Preserves the captured profile dir, viewport, and hardening args.
    const context = await chromium.launchPersistentContext(
      profile.profileDir,
      buildBrowserContextOptions(
        {
          headless: false,
          executablePath: this.resumeExecutablePath,
          viewport: null,
          args: buildChromiumHardeningArgs()
        },
        { ignoreHttpsErrors: this.ignoreHttpsErrors }
      )
    );
    this.logCertificateTrustBypass();
    this.browser = null;
    this.context = context;
    this.page = context.pages()[0] ?? (await context.newPage());

    // Resume recording state before wiring so bindings/handlers observe live actions again.
    this.isRecording = true;
    this.popupCounter = 0;
    this.popupPages.clear();
    this.popupRegistrations.clear();
    this.popupOpeners.clear();
    this.lastClickByPage.clear();
    this.popupSources = new WeakSet<Page>();
    this.instrumentationError = undefined;
    this.signals = [];

    this.attachUrlCapture(this.page);
    this.attachProtectedDetection(this.page, "main");
    // Persistent-context resume: `this.browser` is null here, so `context.close` is the death signal.
    this.attachLivenessWatch(null, context, this.page);
    await this.wireContext(context);

    this.lastActionPage = this.page;
    if (resumeUrl) {
      await this.page.goto(resumeUrl).catch(() => undefined);
    }
    this.lastActionAt = Date.now();

    // Mark the handoff resolved (keep the record for the UI status message).
    this.handoff = {
      ...this.handoff!,
      active: false,
      phase: "resumed",
      message: "Secure session captured and applied. Recorder resumed using the saved session."
    };
  }

  /**
   * Abort an in-progress secure-login handoff: stop any manual Chrome capture, discard the recorder
   * draft, and clear the handoff. Used by both "Cancel recording" and the capture-phase "Cancel".
   */
  public async cancelSecureHandoff(): Promise<void> {
    try {
      this.sessionService?.stopCapture();
    } catch {
      /* best-effort */
    }
    this.isRecording = false;
    await this.closeBrowser();
    await this.discardDraft();
    this.handoff = null;
    this.lastActionPage = null;
    this.popupPages.clear();
    this.ignoreProtectedDetectionSession = false;
    this.ignoredDetectionKeys = new Set<string>();
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * When wait capture is enabled, append a fixed-time wait action representing the user's think-time
   * since the previous action. Sub-threshold gaps (normal UI processing) are ignored, and very long
   * idle gaps are capped so a stray pause can't bake an absurd delay into the flow.
   */
  /**
   * Turn the observation signals seen since the previous action into condition-based `afterWaits`
   * on that previous action. Gated by `captureSmartWaits`; the `fixedDelay` fallback is only used
   * when the legacy fixed-time capture (`captureWaitTime`) is off, to avoid double delays.
   */
  private attachSmartWaits(now: number): void {
    if (!this.captureSmartWaits || this.lastActionAt <= 0) return;
    const prev = this.actions[this.actions.length - 1];
    if (!prev || prev.type === "wait" || prev.type === "routeChange") return;
    const waits = buildSmartWaits(this.signals, this.lastActionAt, now, {
      allowFixedDelayFallback: !this.captureWaitTime,
      adaptiveTimeouts: this.asyncAwareness.enabled && this.asyncAwareness.adaptiveTimeouts,
      minimumTimeoutMs: this.asyncAwareness.minimumTimeoutMs,
      maximumTimeoutMs: this.asyncAwareness.maximumTimeoutMs,
      loaderAppearanceGraceMs: this.asyncAwareness.enabled ? this.asyncAwareness.loaderAppearanceGraceMs : 0
    });
    if (waits.length) prev.afterWaits = waits;
  }

  private maybeInsertWait(now: number): void {
    if (!this.captureWaitTime || this.lastActionAt === 0 || this.actions.length === 0) return;
    const delta = now - this.lastActionAt;
    if (delta < WAIT_CAPTURE_MIN_MS) return;
    const waitMs = Math.min(Math.round(delta), WAIT_CAPTURE_MAX_MS);
    this.actions.push({
      id: randomUUID(),
      type: "wait",
      name: `Wait ${(waitMs / 1000).toFixed(1)}s`,
      waitMs
    });
  }

  public getActions(): RecordedAction[] {
    return this.actions;
  }

  public getStatus() {
    return {
      isRecording: this.isRecording,
      actionCount: this.actions.length,
      /** True when protected-login detection is being ignored (global setting or session override). */
      protectedDetectionIgnored: this.ignoreProtectedDetectionGlobal || this.ignoreProtectedDetectionSession,
      // Drives the Recorder's non-blocking "certificate validation is disabled" indicator.
      ignoreHttpsErrors: this.ignoreHttpsErrors,
      instrumentationError: this.instrumentationError
    };
  }

  /**
   * Warn once per created Recorder browser context that certificate validation is off. Carries no URL,
   * cookie, header, or credential — the Recorder target URL is deliberately not included.
   */
  private logCertificateTrustBypass(): void {
    if (!this.ignoreHttpsErrors) return;
    console.warn(`[security] ${CERTIFICATE_BYPASS_LOG_MESSAGE}`, {
      ignoreHttpsErrors: true,
      surface: "recorder"
    });
  }

  public async stopRecording(): Promise<RecordedAction[]> {
    if (!this.isRecording) {
      return this.actions;
    }

    this.isRecording = false;
    const finalActions = [...this.actions];

    // Flush the finished session to the draft so it survives an app close before Save.
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();

    await this.closeBrowser();

    return finalActions;
  }

  public async cancelRecording(): Promise<void> {
    this.isRecording = false;
    // Also abort any in-progress protected-login handoff / manual Chrome capture.
    try {
      this.sessionService?.stopCapture();
    } catch {
      /* best-effort */
    }
    this.handoff = null;
    await this.discardDraft();
    await this.closeBrowser();
    this.ignoreProtectedDetectionSession = false;
    this.ignoredDetectionKeys = new Set<string>();
  }

  /**
   * Record one action attributed to the page it happened on.
   *
   * Extracted from the `__awtkit_recordAction` binding so the service-level behaviour it owns —
   * consecutive-fill compaction, think-time capture, route-change insertion and page-alias tagging —
   * can be exercised without launching a browser. The binding is now a one-line adapter.
   */
  private recordActionFromPage(sourcePage: Page, action: Omit<RecordedAction, "id">, sourceFrame?: Frame): void {
    // Never capture while paused (e.g. a protected-detection handoff is showing). Defense-in-depth:
    // the automation browser may stay open during the "detected" phase, so the guard — not just a
    // closed browser — is what guarantees nothing on a protected page is ever recorded.
    if (!this.isRecording) return;
    const now = Date.now();
    // Determine the page alias from the popup registry (main page = 'main').
    const pageAlias = (() => {
      for (const [alias, p] of this.popupPages) {
        if (p === sourcePage) return alias;
      }
      return "main";
    })();
    // Live text capture: the page fires an 'input' event per keystroke, so collapse consecutive
    // fills on the same field (same page + same locator) into one action — updating its value
    // in place — instead of appending one action per character.
    const last = this.actions[this.actions.length - 1];
    if (
      action.type === "fill" &&
      last &&
      last.type === "fill" &&
      sourcePage === this.lastActionPage &&
      JSON.stringify(last.locator) === JSON.stringify(action.locator)
    ) {
      last.name = action.name;
      last.valueSource = action.valueSource;
      this.lastActionAt = now; // still typing — reset the think-time clock for the next action
      this.scheduleDraftPersist();
      return;
    }
    // Smart Wait (Phase 2): attach the conditions observed since the previous action as
    // `afterWaits` on that previous action (i.e. what the user waited for after doing it).
    this.attachSmartWaits(now);
    // Optionally record the user's think-time before this action as a fixed-time wait (Task 1).
    this.maybeInsertWait(now);
    // If the interaction happened in a different tab/page than the last recorded action, insert the
    // context switch first, in BOTH directions: a popup target replays through `switchToPopup`
    // (which reuses an already-open popup by alias), a main-page target through `routeChange`.
    // Inserting it here — lazily, at the first action on the new page — is what keeps it idempotent
    // against the several browser events that can announce one transition.
    if (this.lastActionPage && sourcePage !== this.lastActionPage) {
      if (pageAlias === "main") {
        // The step replays via `switchToLatestTab`; the URL is only a `contains` hint. So an
        // unsafe/blank URL must still emit the switch — dropping it would silently replay the
        // next action against the wrong page — it simply carries no hint.
        const safeTarget = RecorderService.safePopupUrl(sourcePage.url())?.toString();
        this.actions.push({
          id: randomUUID(),
          type: "routeChange",
          name: safeTarget ? `Switch to tab: ${safeTarget}` : "Switch to previous tab",
          ...(safeTarget ? { valueSource: { type: "static", value: safeTarget } } : {})
        });
      } else {
        this.actions.push({
          id: randomUUID(),
          type: "switchToPopup",
          name: `Switch to popup: ${pageAlias}`,
          popupExpectation: { popupAlias: pageAlias, waitUntil: "domcontentloaded" }
        });
      }
    }
    this.lastActionPage = sourcePage;
    // Tag the action with its page alias (omit 'main' to keep legacy flows clean).
    const taggedAction: RecordedAction = { ...action, id: randomUUID() };
    if (pageAlias !== "main") taggedAction.pageAlias = pageAlias;
    if (sourceFrame && sourceFrame !== sourcePage.mainFrame() && taggedAction.locator && !taggedAction.locator.context?.frame?.selector) {
      const safeOrigin = (value: string): string | undefined => {
        try {
          const parsed = new URL(value);
          return parsed.origin === "null" ? undefined : parsed.origin;
        } catch {
          return undefined;
        }
      };
      const childOrigin = safeOrigin(sourceFrame.url());
      const pageOrigin = safeOrigin(sourcePage.url());
      const state = childOrigin && pageOrigin ? (childOrigin === pageOrigin ? "same-origin" : "cross-origin") : "unknown";
      taggedAction.locator.interaction = {
        ...taggedAction.locator.interaction,
        frame: { state, name: sourceFrame.name() || undefined, origin: childOrigin }
      };
      taggedAction.locator.resolution = "needs-review";
      taggedAction.locator.resolvedBy = "recorder";
      taggedAction.locator.reviewReason = state === "cross-origin" ? "unsupported cross-origin frame" : "unsupported frame context";
    }
    const reviewLocator = taggedAction.locator;
    const positional = isPositionalLocator(reviewLocator as FlowStep["locator"]);
    const explicitlyUnresolved = reviewLocator?.resolution === "needs-review" || reviewLocator?.resolution === "invalid";
    if (reviewLocator && (reviewLocator.quality?.isUnique === false || positional || explicitlyUnresolved)) {
      // Ambiguous, unsupported, or fragile positional locator: pause before committing the action.
      this.isRecording = false;
      const unsupported = explicitlyUnresolved && reviewLocator.reviewReason !== undefined;
      this.ambiguityState = {
        action: taggedAction,
        kind: unsupported ? "unsupported" : positional ? "positional" : "ambiguous",
        reason:
          reviewLocator.reviewReason ??
          (positional
            ? "The only unique locator is positional and requires explicit approval."
            : `The recorded locator matches ${reviewLocator.quality?.matchCount ?? "multiple"} elements.`),
        canSelectCandidates: !unsupported,
        canApproveFallback: positional && !unsupported,
        canScopeToCurrentContext: !unsupported && (
          reviewLocator.context?.container !== undefined ||
          (reviewLocator.context?.containers?.length ?? 0) > 0
        )
      };
      this.ambiguityPage = sourcePage;
      return;
    }

    this.actions.push(taggedAction);
    if (action.type === "click") {
      this.lastClickByPage.set(sourcePage, { action: taggedAction, at: now });
    }
    this.lastActionAt = now;
    this.scheduleDraftPersist();
  }

  // ── Ambiguity Resolution UX ──────────────────────────────────────────────────

  public getAmbiguityState(): AmbiguityState | null {
    return this.ambiguityState;
  }

  private ambiguityCandidates(action: RecordedAction): LocatorCandidate[] {
    const locator = action.locator;
    if (!locator) return [];
    return [
      { strategy: locator.strategy as LocatorCandidate["strategy"], value: locator.value, name: locator.name, exact: locator.exact },
      ...((locator.alternatives ?? []) as LocatorCandidate[])
    ];
  }

  private async proveCandidateUnique(action: RecordedAction, candidate: LocatorCandidate): Promise<{ matchCount: number; visibleMatchCount: number }> {
    if (!this.ambiguityPage || !action.locator) throw new Error("The recorded page is no longer available for live locator review.");
    const locator = await new LocatorFactory(this.ambiguityPage).locateCandidate(candidate, action.locator.context);
    const matchCount = await locator.count();
    let visibleMatchCount = 0;
    for (let index = 0; index < Math.min(matchCount, 100); index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) visibleMatchCount += 1;
    }
    if (matchCount !== 1 || visibleMatchCount !== 1) {
      throw new Error(`The selected locator is not uniquely actionable (total matches: ${matchCount}, visible matches: ${visibleMatchCount}).`);
    }
    return { matchCount, visibleMatchCount };
  }

  private applyResolvedCandidate(action: RecordedAction, candidate: LocatorCandidate, evidence: { matchCount: number; visibleMatchCount: number }): void {
    const locator = action.locator!;
    locator.strategy = candidate.strategy;
    locator.value = candidate.value;
    locator.name = candidate.name;
    locator.exact = candidate.exact;
    locator.quality = {
      strategy: candidate.strategy,
      isUnique: true,
      matchCount: evidence.matchCount,
      visibleMatchCount: evidence.visibleMatchCount,
      candidateCount: 1 + (locator.alternatives?.length ?? 0),
      confidence: "medium"
    };
    locator.resolution = "resolved";
    locator.resolvedBy = "user";
    delete locator.approvedFallbackReason;
    delete locator.approvedFallbackBinding;
    delete locator.reviewReason;
  }

  private commitAmbiguityAction(action: RecordedAction): void {
    this.actions.push(action);
    this.lastActionAt = Date.now();
    this.ambiguityState = null;
    this.ambiguityPage = null;
    this.scheduleDraftPersist();
    this.isRecording = true;
  }

  public async resolveAmbiguity(
    choice: AmbiguityResolutionChoice,
    payload?: AmbiguityResolutionPayload
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.ambiguityState) return { success: false, error: "No locator review is active." };

    const state = this.ambiguityState;
    const action = state.action;
    
    if (choice === "cancel") {
      this.ambiguityState = null;
      this.ambiguityPage = null;
      this.isRecording = true;
      return { success: true };
    }

    if (choice === "defer") {
      action.locator!.resolution = "needs-review";
      action.locator!.resolvedBy = "recorder";
      this.commitAmbiguityAction(action);
      return { success: true };
    } else if (choice === "approveFallback") {
      const reason = payload?.approvalReason?.trim() ?? "";
      if (!state.canApproveFallback || !isPositionalLocator(action.locator as FlowStep["locator"])) {
        return { success: false, error: "This locator is not an approvable positional fallback." };
      }
      if (reason.length < 8) return { success: false, error: "Enter a specific approval reason (at least 8 characters)." };
      action.locator!.resolution = "user-approved-fallback";
      action.locator!.resolvedBy = "user";
      action.locator!.approvedFallbackReason = reason;
      action.locator!.approvedFallbackBinding = createLocatorApprovalBinding({
        type: action.type as FlowStep["type"],
        name: action.name,
        locator: action.locator as FlowStep["locator"]
      });
      delete action.locator!.reviewReason;
      this.commitAmbiguityAction(action);
      return { success: true };
    } else if (choice === "selectCandidate" && payload?.candidateIndex !== undefined) {
      if (!state.canSelectCandidates) return { success: false, error: "This boundary cannot be resolved by selecting a diagnostic host locator." };
      const candidate = action.locator!.alternatives?.[payload.candidateIndex] as LocatorCandidate | undefined;
      if (!candidate) return { success: false, error: "The selected locator alternative no longer exists." };
      if (isPositionalCandidate(candidate)) return { success: false, error: "A positional alternative must use explicit fallback approval." };
      const evidence = await this.proveCandidateUnique(action, candidate);
      this.applyResolvedCandidate(action, candidate, evidence);
      this.commitAmbiguityAction(action);
      return { success: true };
    } else if (choice === "scopeToAncestor") {
      if (!state.canScopeToCurrentContext || !action.locator?.context?.container) {
        return { success: false, error: "No stable captured ancestor scope is available for this action." };
      }
      for (const candidate of this.ambiguityCandidates(action)) {
        if (isPositionalCandidate(candidate)) continue;
        try {
          const evidence = await this.proveCandidateUnique(action, candidate);
          this.applyResolvedCandidate(action, candidate, evidence);
          this.commitAmbiguityAction(action);
          return { success: true };
        } catch {
          // Try the next ranked stable candidate under the same captured context.
        }
      }
      return { success: false, error: "No non-positional locator resolves uniquely inside the captured ancestor scope." };
    }

    return { success: false, error: "Choose a valid locator-review action." };
  }

  public async highlightAmbiguityCandidate(candidateIndex?: number): Promise<{ success: boolean }> {
    const state = this.ambiguityState;
    if (!state || !this.ambiguityPage || !state.action.locator) return { success: false };
    try {
      const candidate = candidateIndex === undefined
        ? this.ambiguityCandidates(state.action)[0]
        : (state.action.locator.alternatives?.[candidateIndex] as LocatorCandidate | undefined);
      if (!candidate) return { success: false };
      await this.clearHighlight();
      const locator = await new LocatorFactory(this.ambiguityPage).locateCandidate(candidate, state.action.locator.context);
      await locator.evaluateAll((elements) => {
        for (const element of elements.slice(0, 20)) {
          const rect = element.getBoundingClientRect();
          const overlay = document.createElement("div");
          overlay.dataset.awkitLocatorHighlight = "true";
          overlay.style.position = "fixed";
          overlay.style.inset = `${rect.top}px auto auto ${rect.left}px`;
          overlay.style.width = `${rect.width}px`;
          overlay.style.height = `${rect.height}px`;
          overlay.style.border = "3px solid #ff0055";
          overlay.style.background = "rgba(255, 0, 85, 0.15)";
          overlay.style.zIndex = "2147483647";
          overlay.style.pointerEvents = "none";
          overlay.style.boxSizing = "border-box";
          document.documentElement.appendChild(overlay);
        }
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  public async clearHighlight(): Promise<{ success: boolean }> {
    const page = this.ambiguityPage;
    if (!page) return { success: false };
    try {
      await page.evaluate(() => document.querySelectorAll('[data-awkit-locator-highlight="true"]').forEach((element) => element.remove()));
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}


export const recorderService = new RecorderService();
