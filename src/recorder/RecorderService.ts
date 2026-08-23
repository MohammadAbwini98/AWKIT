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
import { removeRecordedAction } from "./recordedActionMutations";
import { getRecorderInitScriptContent } from "./recorderInitScript";
import { buildSmartWaits, type RecordedSignal } from "./smartWaitObservation";
import { detectRecorderProtectedLogin } from "../security/ProtectedLoginDetector";
import { buildChromiumHardeningArgs } from "../runner/ChromiumHardening";
import type { SessionCaptureService } from "../session/SessionCaptureService";
import type { SessionProfile } from "../session/SessionProfile";
import { normalizeOrigin } from "../session/sessionMatch";
import { createLocatorApprovalBinding, isPositionalCandidate, isPositionalLocator } from "../profiles/locatorApproval";
import type { DialogExpectation, FlowStep, LocatorCandidate } from "../profiles/FlowProfile";
import { buildFrameChain } from "./frameChainCapture";
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
  /**
   * Opener page -> the slot a popup awaiting identity has reserved on it. Playwright fires the popup
   * event during the click's DEFAULT ACTION, so the recorder's async binding usually commits that
   * click AFTER the popup already exists. Letting the next click to commit claim the slot is
   * therefore the causal direction; reading "the opener's latest click" once identity resolves is
   * not, because by then the user may have clicked something else.
   */
  private popupAttributions = new Map<Page, { action?: RecordedAction; createdAt: number }>();
  /** Serializes every recorded action so per-page waits cannot reorder the recorded flow. */
  private actionQueue: Promise<void> = Promise.resolve();
  /** The same slots keyed by the POPUP, so both announcing events share one object. */
  private popupAttributionOf = new Map<Page, { action?: RecordedAction; createdAt: number }>();
  /** Pages already carrying the direct causal popup listener. */
  private popupSources = new WeakSet<Page>();
  /** Pages already carrying a dialog listener, so re-wiring never doubles the handler. */
  private dialogSources = new WeakSet<Page>();
  /**
   * The most recent action recorded on each page. A dialog is caused by the action that ran just
   * before it, which is not always a click — a `select` change or a keypress can open one too.
   */
  private lastActionByPage = new Map<Page, { action: RecordedAction; at: number }>();
  /**
   * A dialog whose triggering action has not landed yet. The in-page capture listener runs in the
   * CAPTURE phase and the page's own handler in the bubble phase, so the action normally arrives
   * first — but the binding is async and the dialog event is not, so both orders happen.
   */
  private pendingDialogs = new Map<Page, { expectation: DialogExpectation; at: number }>();
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

  /**
   * Was this navigation caused by something the user already did, or did it arrive on its own?
   *
   * A recorded action on the page since its last navigation is the causal evidence: click Login and
   * the URL changes, and replay reproduces the navigation by replaying the click. Nothing recorded
   * since means the transition came from outside the recorded actions — the address bar, the back
   * button, or a redirect that landed somewhere the click did not explain — and replay has no way to
   * reach the new page unless the navigation is recorded as a step of its own.
   *
   * Deliberately a SEQUENCE rule rather than a time window. "Did an action happen since the last
   * navigation" is deterministic; "did an action happen within N milliseconds" is a race that fails
   * differently on a slow machine.
   */
  private pagesWithActionSinceNavigation = new WeakSet<Page>();

  /** The session's opening navigation already has an explicit `goto`; never emit a second one. */
  private initialNavigationRecorded = false;

  /**
   * Emit a navigation step for a transition the recorded actions cannot explain.
   *
   * This is the third case in the navigation model: action-caused navigation stays implicit (the
   * triggering action replays it, and Playwright's auto-waiting carries it), while INDEPENDENT
   * navigation needs a step or replay silently diverges from what was recorded. Emitting a step
   * after every URL change instead would produce exactly the redundant Navigate nodes this
   * deliberately avoids.
   */
  private recordIndependentNavigation(page: Page, maskedUrl: string): void {
    // Popups announce themselves through their own registration and `switchToPopup`; a second
    // navigation step for the same event would contradict it.
    for (const popup of this.popupPages.values()) if (popup === page) return;
    if (this.popupRegistrations.has(page)) return;

    this.actions.push({
      id: randomUUID(),
      type: "goto",
      name: `Navigate to ${maskedUrl}`,
      valueSource: { type: "static", value: maskedUrl }
    });
    this.lastActionPage = page;
    this.lastActionAt = Date.now();
    this.scheduleDraftPersist();
  }

  /** Record a navigated URL (masked + deduped) and enrich the title best-effort. */
  private captureUrl(page: Page, rawUrl: string): void {
    if (!this.isRecording) return;
    if (!rawUrl || rawUrl === "about:blank") return;
    if (/^(chrome-error|chrome|devtools|about|data|blob):/i.test(rawUrl)) return;

    const url = RecorderService.maskUrl(rawUrl);

    // Causal attribution runs on EVERY main-frame navigation, before the URL-history dedupe below —
    // revisiting a known URL still needs a step when nothing the user did explains the move.
    const causedByRecordedAction = this.pagesWithActionSinceNavigation.has(page);
    this.pagesWithActionSinceNavigation.delete(page);
    if (!this.initialNavigationRecorded) {
      this.initialNavigationRecorded = true;
    } else if (!causedByRecordedAction) {
      this.recordIndependentNavigation(page, url);
    }

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
    this.initialNavigationRecorded = false;
    this.popupCounter = 0;
    this.popupPages.clear();
    this.popupRegistrations.clear();
    this.popupOpeners.clear();
    this.lastClickByPage.clear();
    this.popupAttributions.clear();
    this.popupAttributionOf.clear();
    this.actionQueue = Promise.resolve();
    this.popupSources = new WeakSet<Page>();
    this.dialogSources = new WeakSet<Page>();
    this.lastActionByPage = new Map<Page, { action: RecordedAction; at: number }>();
    this.pendingDialogs = new Map<Page, { expectation: DialogExpectation; at: number }>();
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
    this.popupAttributions = new Map<Page, { action?: RecordedAction; createdAt: number }>();
    this.popupAttributionOf = new Map<Page, { action?: RecordedAction; createdAt: number }>();
    this.actionQueue = Promise.resolve();
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
      // The opening navigation now has its step; anything further that no action explains is a
      // genuine independent navigation.
      this.initialNavigationRecorded = true;
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
      const page = source.page;
      const frame = source.frame;
      // ONE ordered pipeline across every page. A popup action must wait for that popup's
      // registration so it is never mis-tagged `main` — and every action that arrives after it must
      // wait behind it too. Awaiting per-page instead lets an action on an unblocked page overtake a
      // popup action that is still waiting, so the recorded order stops matching what the user did.
      const queued = this.actionQueue.then(async () => {
        await this.popupRegistrations.get(page)?.catch((error) => this.noteInstrumentationError(error));
        // Cross-origin / nested frame: build the ordered frame chain through Playwright's Frame graph
        // (frameElement works across origins; the parent document is never scripted). Attach it before
        // recording so buildRecordedFlow carries it through; a failure leaves it for the needs-review path.
        if (frame && frame !== page.mainFrame() && action.locator && !action.locator.context?.frameChain?.length) {
          const chain = await buildFrameChain(frame).catch(() => undefined);
          if (chain && chain.length) {
            action.locator.context = { ...(action.locator.context ?? {}), frameChain: chain };
          }
        }
        this.recordActionFromPage(page, action, frame);
      });
      this.actionQueue = queued.catch(() => undefined);
      await queued;
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
    for (const page of context.pages()) {
      this.attachPopupSource(page);
      this.attachDialogCapture(page);
    }
  }

  /**
   * Observe and ANSWER the native JavaScript dialogs the recorded page opens, and record the policy
   * on the action that opened them.
   *
   * Playwright auto-dismisses a dialog when nothing is listening. That is not a neutral default: the
   * recorded page's `confirm()` returned false and its `prompt()` returned null while the user was
   * recording, so the capture never reflected what the site actually does — and the saved flow said
   * nothing about the dialog either, leaving replay to hit the same silent dismissal.
   *
   * The recorder therefore accepts, which is what pressing OK does, and writes an explicit
   * {@link DialogExpectation} onto the triggering action. Accepting is a DECLARED default the user
   * can change in the Flow Designer, not hidden behaviour: the saved step carries the policy, so
   * dismissing instead — or asserting the message, or answering a prompt with real text — is an edit
   * rather than a re-record.
   */
  private attachDialogCapture(page: Page): void {
    if (this.dialogSources.has(page)) return;
    this.dialogSources.add(page);
    page.on("dialog", (dialog) => {
      const kind = dialog.type() as DialogExpectation["dialogKind"];
      const defaultValue = typeof dialog.defaultValue === "function" ? dialog.defaultValue() : "";
      // Answer first, unconditionally: an unanswered dialog blocks the page for the whole session,
      // recording or not.
      void dialog.accept(kind === "prompt" ? defaultValue : undefined).catch(() => undefined);
      if (!this.isRecording) return;
      // The observed MESSAGE is deliberately not persisted. It is page text that can carry order
      // numbers, names or balances, and asserting it is a choice the user makes in the designer —
      // recording it would silently make every replay brittle against copy the site controls.
      const expectation: DialogExpectation = {
        action: "accept",
        ...(kind ? { dialogKind: kind } : {}),
        ...(kind === "prompt" ? { promptText: defaultValue } : {})
      };
      this.attributeDialog(page, expectation);
    });
  }

  /** A dialog that lands within this long AFTER its action may still be attributed to it. */
  private static readonly DIALOG_ATTRIBUTION_LOOKBACK_MS = 2_000;
  /** How long a dialog waits for its triggering action's binding to arrive. */
  private static readonly DIALOG_ATTRIBUTION_LAG_MS = 2_000;

  /** Bind an observed dialog to the action that caused it, in whichever order the two arrive. */
  private attributeDialog(page: Page, expectation: DialogExpectation): void {
    const now = Date.now();
    const recent = this.lastActionByPage.get(page);
    if (recent && now - recent.at <= RecorderService.DIALOG_ATTRIBUTION_LOOKBACK_MS && !recent.action.dialogExpectation) {
      recent.action.dialogExpectation = expectation;
      this.scheduleDraftPersist();
      return;
    }
    // The action has not landed yet; the next one recorded on this page claims it.
    this.pendingDialogs.set(page, { expectation, at: now });
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

  /** Overall ceiling on identity resolution; a popup that never commits stays alias-only. */
  /** A click binding that lands within this long AFTER the popup event may still be its opener. */
  private static readonly POPUP_OPENER_LAG_MS = 500;
  /** How far back a click already committed before the popup appeared may still be its opener. */
  private static readonly POPUP_OPENER_LOOKBACK_MS = 1_000;
  private static readonly POPUP_IDENTITY_BUDGET_MS = 2_000;
  /**
   * How long a committed URL must stand unchallenged before it is accepted as identity. A
   * client-side redirect (`location.replace`, meta refresh) COMMITS its intermediate document, so a
   * first-commit-wins rule would lock onto the hop. A server 302 never commits, which is why the
   * redirect case alone cannot expose this.
   */
  private static readonly POPUP_IDENTITY_QUIET_MS = 250;

  /**
   * Resolve a popup's identity-bearing URL: the LAST main-frame URL that stays put for a quiet
   * period, within a bounded budget. Handles both `about:blank`-then-navigate and a page that
   * commits and then redirects itself. Returns undefined when nothing identity-bearing ever commits
   * (a popup that intentionally stays blank), which falls back to arrival-order aliasing.
   */
  private async popupIdentityUrl(page: Page): Promise<URL | undefined> {
    return await new Promise<URL | undefined>((resolve) => {
      let candidate = RecorderService.safePopupUrl(page.url());
      let settled = false;
      let quiet: ReturnType<typeof setTimeout> | undefined;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(budget);
        if (quiet) clearTimeout(quiet);
        page.off("framenavigated", onNavigated);
        page.off("close", onClose);
        resolve(candidate);
      };
      // Each new commit supersedes the previous candidate and restarts the quiet period, so a chain
      // of client-side hops settles on its final URL rather than its first.
      const armQuiet = (): void => {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, RecorderService.POPUP_IDENTITY_QUIET_MS);
      };
      const onNavigated = (frame: Frame): void => {
        if (frame !== page.mainFrame()) return;
        const value = RecorderService.safePopupUrl(page.url());
        if (!value) return;
        candidate = value;
        armQuiet();
      };
      const onClose = (): void => finish();

      const budget = setTimeout(finish, RecorderService.POPUP_IDENTITY_BUDGET_MS);
      page.on("framenavigated", onNavigated);
      page.on("close", onClose);
      // Already meaningful at creation: still give a self-redirect its chance to supersede this.
      if (candidate) armQuiet();
    });
  }

  /** Register, instrument, attribute, and close-track one popup through one deduplicated pipeline. */
  private registerPopup(opened: Page, opener?: Page): Promise<string> {
    if (opener) this.popupOpeners.set(opened, opener);
    // One attribution slot per popup, created on whichever event announces it first.
    let attribution = this.popupAttributionOf.get(opened);
    if (!attribution) {
      attribution = { createdAt: Date.now() };
      this.popupAttributionOf.set(opened, attribution);
    }
    const createdAt = attribution.createdAt;
    // Index it under the opener as soon as the opener is KNOWN, which is not necessarily on the
    // first call: `context.on("page")` fires before `page.on("popup")`, so the first call often has
    // no opener at all. Doing this before the dedupe early-return is what lets the second call
    // install the reservation. Reserving synchronously means the opening click's binding — which
    // lands a few ms later — claims this popup, and no subsequent click can.
    const causalOpener = opener ?? this.popupOpeners.get(opened);
    if (causalOpener && !attribution.action) {
      // WHICH page opened the popup is causal (`page.on("popup")`). WHICH click on that page is
      // not: the capture binding is an async round trip, so it can commit either side of the popup
      // events, in either order. Handle both, and consume the slot on first claim so a later
      // unrelated click can never inherit it.
      const prior = this.lastClickByPage.get(causalOpener);
      const landedJustAfter = prior && prior.at - createdAt <= RecorderService.POPUP_OPENER_LAG_MS;
      const landedJustBefore = prior && createdAt - prior.at <= RecorderService.POPUP_OPENER_LOOKBACK_MS;
      if (prior && landedJustAfter && landedJustBefore) {
        attribution.action = prior.action;
      } else if (!this.popupAttributions.has(causalOpener)) {
        this.popupAttributions.set(causalOpener, attribution);
      }
    }

    const existing = this.popupRegistrations.get(opened);
    if (existing) return existing;

    const registration = (async (): Promise<string> => {
      this.attachUrlCapture(opened);
      this.attachPopupSource(opened);
    this.attachDialogCapture(opened);
      // Instrument BEFORE resolving identity, never after.
      //
      // Identity resolution waits up to POPUP_IDENTITY_BUDGET_MS for the popup's URL to settle, and
      // a `window.open('') + document.write(...)` popup never commits a URL at all — so it always
      // spends the full budget. Re-injecting after that left a two-second window in which the popup
      // was on screen, interactive, and recording NOTHING. Instrumentation does not depend on the
      // alias, so it goes first; an action captured before the alias is known still waits on this
      // registration in the binding queue and is tagged correctly once it resolves.
      //
      // Context init scripts already cover future popup documents; this is the idempotent live
      // fallback for blank-document lifecycles. Any failure becomes visible in Recorder status.
      if (!opened.isClosed()) {
        // Probe the DOCUMENT marker, not the window flag. A popup built with `document.write` keeps
        // the window flag while `document.open()` destroys every listener, so reading the window
        // told us the capture was live for a page that was recording nothing.
        const installed = await opened
          .evaluate(() => {
            const root = document.documentElement as unknown as { __awtkitCaptureInstalled?: boolean } | null;
            return Boolean(root && root.__awtkitCaptureInstalled);
          })
          .catch(() => false);
        if (!installed) await opened.evaluate(getRecorderInitScriptContent()).catch((error) => this.noteInstrumentationError(error));
      }

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

      // Attribution: the slot reserved above, claimed by the opening click when it committed. If it
      // is still empty the binding may have landed BEFORE the popup event, so fall back to a click
      // that already preceded creation. No timing yield is needed — correctness comes from the
      // reservation, not from a delay.
      const opener2 = causalOpener ?? this.popupOpeners.get(opened);
      if (opener2) this.popupAttributions.delete(opener2);
      let attributed = attribution.action;
      if (!attributed && opener2) {
        const prior = this.lastClickByPage.get(opener2);
        if (prior && prior.at <= createdAt && createdAt - prior.at <= 3_000) attributed = prior.action;
      }
      if (attributed) {
        attributed.opensPopup = true;
        attributed.popupExpectation = {
          popupAlias: alias,
          urlContains: identityUrl?.toString(),
          waitUntil: "domcontentloaded"
        };
      }

      opened.on("close", () => {
        if (this.popupPages.get(alias) === opened) this.popupPages.delete(alias);
        this.popupOpeners.delete(opened);
        this.popupRegistrations.delete(opened);
        this.popupAttributionOf.delete(opened);
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

      // Insert the secure-session nodes (deduped) near the start of the recorded flow. The Auto
      // Secure Login node must carry the URL WHERE THE LOGIN HAPPENS (the detected protected page /
      // captured loginUrl), not the site being recorded: at replay time `executeAutoSecureLogin`
      // reuses an existing session by ORIGIN match, and IdP redirects mean the login origin
      // (accounts.google.com, login.microsoftonline.com, …) differs from the site origin. Embedding
      // the site URL made replay spawn a redundant manual-login browser instead of reusing.
      // Navigation after resume still uses resumeUrl (back on the original site).
      const resumeUrl = this.handoff.resumeUrl || profile.targetUrl || this.handoff.detectedUrl;
      const loginTarget = this.handoff.detectedUrl || profile.loginUrl || profile.targetUrl || resumeUrl;
      this.insertSecureSessionNodes(sessionId, loginTarget);

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
    this.popupAttributions.clear();
    this.popupAttributionOf.clear();
    this.actionQueue = Promise.resolve();
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
   * Abort an in-progress secure-login handoff: stop any manual Chrome capture and clear the handoff.
   * The pre-login draft is deliberately PRESERVED (flushed to disk and kept in memory) so cancelling
   * a handoff never discards the actions recorded before the protected-login pause — the user can
   * resume or save them. Discarding is owned by `cancelRecording` (full-recording Cancel) and by the
   * save path, not by a handoff cancel.
   */
  public async cancelSecureHandoff(): Promise<void> {
    try {
      this.sessionService?.stopCapture();
    } catch {
      /* best-effort */
    }
    this.isRecording = false;
    await this.closeBrowser();
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();
    this.handoff = null;
    this.lastActionPage = null;
    this.popupPages.clear();
    // AWKIT-REC-036: cancelling the handoff used to leave ambiguityState/ambiguityPage pointing at
    // the just-closed page (the AWKIT-REC-001 fix removed the incidental discardDraft() call that
    // had been clearing them), so previewCandidate could hit a raw Playwright "target closed".
    this.ambiguityState = null;
    this.ambiguityPage = null;
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
      actionId: prev.id,
      actionType: prev.type,
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

  /** Clear captured actions while preserving URL history and any live browser session. */
  public async clearActions(): Promise<RecordedAction[]> {
    await this.actionQueue.catch(() => undefined);
    this.actions = [];
    this.lastActionAt = 0;
    this.lastActionPage = null;
    this.signals = [];
    this.lastClickByPage.clear();
    this.popupAttributions.clear();
    this.popupAttributionOf.clear();
    // A dialog attributed to a cleared action, or one still waiting for its action, must not attach
    // itself to the first action of the continued recording.
    this.lastActionByPage.clear();
    this.pendingDialogs.clear();
    this.ambiguityState = null;
    this.ambiguityPage = null;
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();
    return this.actions;
  }

  /** Delete one action plus its strictly dependent synthetic wait/popup lifecycle actions. */
  public async deleteAction(actionId: string): Promise<{ actions: RecordedAction[]; removedIds: string[] }> {
    await this.actionQueue.catch(() => undefined);
    const result = removeRecordedAction(this.actions, actionId);
    if (result.removedIds.length === 0) return result;
    this.actions = result.actions;
    this.lastActionAt = 0;
    this.signals = [];
    for (const [page, click] of this.lastClickByPage) {
      if (result.removedIds.includes(click.action.id)) this.lastClickByPage.delete(page);
    }
    for (const [page, attribution] of this.popupAttributions) {
      if (attribution.action && result.removedIds.includes(attribution.action.id)) this.popupAttributions.delete(page);
    }
    if (this.ambiguityState && result.removedIds.includes(this.ambiguityState.action.id)) {
      this.ambiguityState = null;
      this.ambiguityPage = null;
    }
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();
    return result;
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
    // Drain any capture that was already accepted before closing the browser. Besides preserving the
    // final action, this guarantees later draft mutations never inherit an orphaned binding promise.
    await this.actionQueue.catch(() => undefined);
    const finalActions = [...this.actions];

    // Flush the finished session to the draft so it survives an app close before Save.
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    await this.persistDraft();

    await this.closeBrowser();

    // AWKIT-REC-036: same pre-existing gap as cancelSecureHandoff — the ambiguity state can point
    // at the just-closed page, so previewCandidate would surface a raw "target closed" error.
    this.ambiguityState = null;
    this.ambiguityPage = null;

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
    // Causal evidence for the next navigation on this page: if the URL changes after this, the
    // change is explained by an action the user actually performed and needs no step of its own.
    this.pagesWithActionSinceNavigation.add(sourcePage);
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
    const sameStableTarget = (left?: RecordedAction["locator"], right?: RecordedAction["locator"]): boolean => {
      if (!left || !right) return false;
      return JSON.stringify({
        strategy: left.strategy,
        value: left.value,
        name: left.name,
        exact: left.exact,
        context: left.context
      }) === JSON.stringify({
        strategy: right.strategy,
        value: right.value,
        name: right.name,
        exact: right.exact,
        context: right.context
      });
    };
    /**
     * Drop the change/blur echo a field emits when focus leaves it.
     *
     * Typing "alice" then Tab records: fill Username="alice", press Tab, fill Username="alice". The
     * trailing fill is the browser's change event replaying a value already captured, and the
     * coalescing below cannot absorb it because the Tab sits between them.
     *
     * The tempting rule — "drop any fill whose value matches the last fill on that target" — is
     * WRONG, and that is why this was deferred rather than patched. It would silently discard a
     * legitimate re-entry: fill A, click Clear, fill A again is a real sequence, and dropping the
     * second breaks replay against any form with a reset control.
     *
     * So the question is not whether the values match, it is whether anything IN BETWEEN could have
     * changed the field. Only actions that move focus or the pointer without mutating a value
     * qualify: navigation keypresses and hovers. A click, a Backspace/Delete/Escape, another fill —
     * anything that might have altered the control — makes the later fill meaningful and it is kept.
     */
    const VALUE_PRESERVING_KEYS = new Set([
      "Tab", "Shift+Tab",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", "PageUp", "PageDown"
    ]);
    const cannotChangeFieldValue = (candidate: RecordedAction): boolean => {
      if (candidate.type === "hover") return true;
      if (candidate.type !== "press") return false;
      const key = typeof candidate.valueSource?.value === "string" ? candidate.valueSource.value : "";
      return VALUE_PRESERVING_KEYS.has(key);
    };

    if (action.type === "fill" && sourcePage === this.lastActionPage) {
      // Explicit reverse scan: `findLastIndex` needs an es2023 lib target this project does not set.
      let previousFillIndex = -1;
      for (let i = this.actions.length - 1; i >= 0; i -= 1) {
        const candidate = this.actions[i] as RecordedAction;
        if (candidate.type === "fill" && sameStableTarget(candidate.locator, action.locator)) {
          previousFillIndex = i;
          break;
        }
      }
      if (previousFillIndex !== -1 && previousFillIndex !== this.actions.length - 1) {
        const previousFill = this.actions[previousFillIndex] as RecordedAction;
        const between = this.actions.slice(previousFillIndex + 1);
        const sameValue =
          JSON.stringify(previousFill.valueSource ?? null) === JSON.stringify(action.valueSource ?? null);
        if (sameValue && between.every(cannotChangeFieldValue)) {
          this.scheduleDraftPersist();
          return; // echo of a value already recorded; nothing between it could have changed the field
        }
      }
    }

    /*
     * A double-click absorbs the click that opened it.
     *
     * The browser fires click(detail 1) → click(detail 2) → dblclick. The init script drops the
     * detail-2 click in-page, which leaves exactly one ordinary click sitting in front of the
     * gesture. Removing it here rather than in the page keeps coalescing in its documented owner —
     * the same division of labour as the fill echo below — and means the harness path and the real
     * recorder path cannot disagree about how many actions a double-click produces.
     *
     * Deliberately narrow: only the IMMEDIATELY preceding action, only on the same page, only when
     * it is a click on the same stable target. A click on something else stays, because the user
     * really did click something else.
     */
    if (
      action.type === "dblclick" &&
      last &&
      last.type === "click" &&
      sourcePage === this.lastActionPage &&
      sameStableTarget(last.locator, action.locator)
    ) {
      this.actions.pop();
    }
    if (
      action.type === "fill" &&
      last &&
      last.type === "fill" &&
      sourcePage === this.lastActionPage &&
      sameStableTarget(last.locator, action.locator)
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
      // A frame chain was captured (Frame-graph, cross-origin safe) → the step is resolvable; leave the
      // resolution to buildRecordedFlow. Only when no chain could be built do we fall back to review.
      if (!taggedAction.locator.context?.frameChain?.length) {
        taggedAction.locator.resolution = "needs-review";
        taggedAction.locator.resolvedBy = "recorder";
        taggedAction.locator.reviewReason = state === "cross-origin" ? "unsupported cross-origin frame" : "unsupported frame context";
      }
    }
    // Recording is never paused for ambiguity. Locator finalization (persist a guarded positional
    // identity for normal/sensitive actions, or flag the rare
    // unrepresentable target for review) is owned by `buildRecordedFlow`, the single pure builder used
    // by BOTH this live session and the test harness, so both paths finalize identically.
    this.actions.push(taggedAction);
    // A dialog that arrived before this action's binding landed belongs to it.
    const pendingDialog = this.pendingDialogs.get(sourcePage);
    if (pendingDialog && now - pendingDialog.at <= RecorderService.DIALOG_ATTRIBUTION_LAG_MS) {
      taggedAction.dialogExpectation = pendingDialog.expectation;
      this.pendingDialogs.delete(sourcePage);
    }
    // Every action, not just clicks: a `select` change or a keypress can open a dialog too.
    this.lastActionByPage.set(sourcePage, { action: taggedAction, at: now });
    if (action.type === "click") {
      this.lastClickByPage.set(sourcePage, { action: taggedAction, at: now });
      // Claim a popup that appeared during this click's default action. First committed click wins
      // and the slot is consumed, so a later unrelated click can never inherit the attribution.
      const pending = this.popupAttributions.get(sourcePage);
      if (pending && !pending.action && now - pending.createdAt <= RecorderService.POPUP_OPENER_LAG_MS) {
        pending.action = taggedAction;
        this.popupAttributions.delete(sourcePage);
      }
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
