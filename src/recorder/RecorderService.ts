import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecordedAction, RecordedUrl } from "./RecorderTypes";
import { getRecorderInitScriptContent } from "./recorderInitScript";
import { buildSmartWaits, type RecordedSignal } from "./smartWaitObservation";

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
    this.draftLoad = Promise.resolve(); // don't re-restore the just-cleared draft
    if (this.draftPath) {
      await rm(this.draftPath, { force: true }).catch(() => undefined);
    }
  }

  /** Tear down the browser and reset state so a failed start never leaves us "in progress". */
  private async cleanup(): Promise<void> {
    this.isRecording = false;
    this.lastActionPage = null;
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  public async startRecording(url: string, options: StartRecordingOptions = {}): Promise<void> {
    if (this.isRecording) {
      throw new Error("Recording is already in progress.");
    }

    // The reusable URL history must be loaded before we start appending this session's URLs.
    await this.ensureUrlHistoryLoaded();

    const target = RecorderService.normalizeUrl(url);

    this.actions = [];
    this.urlSessionId = randomUUID();
    this.isRecording = true;
    this.lastActionPage = null;
    this.captureWaitTime = options.captureWaitTime ?? false;
    this.captureSmartWaits = options.captureSmartWaits ?? true;
    this.signals = [];
    this.lastActionAt = 0;
    // A new recording replaces any leftover draft; block a pending restore from clobbering it.
    this.draftLoad = Promise.resolve();
    this.scheduleDraftPersist();

    try {
    // In packaged/offline mode the caller passes the bundled Chromium path so the
    // recorder never attempts to download or locate a globally installed browser.
    this.browser = await chromium.launch({ headless: false, executablePath: options.executablePath });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    // Capture URLs visited during recording (initial page + any tab the site opens).
    this.attachUrlCapture(this.page);
    this.context.on("page", (opened) => this.attachUrlCapture(opened));

    await this.context.exposeBinding("__awtkit_recordAction", (source, action: Omit<RecordedAction, "id">) => {
      const sourcePage = source.page;
      const now = Date.now();
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
      // If the interaction happened in a different tab/page than the last recorded
      // action, insert a Route Change action so the saved flow switches context first.
      if (this.lastActionPage && sourcePage !== this.lastActionPage) {
        const targetUrl = sourcePage.url();
        this.actions.push({
          id: randomUUID(),
          type: "routeChange",
          name: `Switch to tab: ${targetUrl}`,
          valueSource: { type: "static", value: targetUrl }
        });
      }
      this.lastActionPage = sourcePage;
      this.actions.push({ ...action, id: randomUUID() });
      this.lastActionAt = now;
      this.scheduleDraftPersist();
    });

    // Buffer raw Smart Wait observation signals (loader/network/url/rows/toast/enabled). Only safe
    // metadata is stored (method + URL path, selectors, short text) — never headers/bodies/secrets.
    await this.context.exposeBinding("__awtkit_recordSignal", (_source, s: RecordedSignal) => {
      if (!this.captureSmartWaits) return;
      this.signals.push(s);
      const cap = 2000;
      if (this.signals.length > cap) this.signals.splice(0, this.signals.length - cap);
    });

    // Inject the shared capture script. It generates ranked, uniqueness-validated
    // locators in the page DOM (semantic first; utility-class selectors never) so the
    // recorder saves Playwright-safe locators instead of generic CSS class selectors.
    await this.context.addInitScript({ content: getRecorderInitScriptContent() });

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
      throw error;
    }
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
      allowFixedDelayFallback: !this.captureWaitTime
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
      actionCount: this.actions.length
    };
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

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }

    return finalActions;
  }

  public async cancelRecording(): Promise<void> {
    this.isRecording = false;
    await this.discardDraft();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

export const recorderService = new RecorderService();
