import type { LocatorQuality, LocatorCandidate, LocatorContext, WaitCondition } from "../profiles/FlowProfile";

export type { LocatorQuality } from "../profiles/FlowProfile";

export interface RecordedActionLocator {
  strategy: string;
  value: string;
  name?: string;
  /** For role/text strategies: match the accessible name/text exactly. */
  exact?: boolean;
  /** Uniqueness/quality metadata computed at record time. */
  quality?: LocatorQuality;
  /** Ranked fallback candidates the runner can try when the primary is ambiguous. */
  alternatives?: LocatorCandidate[];
  /** Container/frame scoping (visible dialog, table row, card, iframe) detected at record time. */
  context?: LocatorContext;
}

export interface RecordedAction {
  id: string;
  type: string;
  name: string;
  locator?: RecordedActionLocator;
  valueSource?: {
    type: string;
    value: string;
  };
  /**
   * For synthetic `wait` actions inserted when "capture waiting time" is enabled: the measured
   * think-time (ms) the user paused before the following action. Saved as a fixed-time wait step.
   */
  waitMs?: number;
  /** Smart Wait conditions to satisfy BEFORE this action runs (recorder observation, Phase 2). */
  beforeWaits?: WaitCondition[];
  /** Smart Wait conditions observed AFTER this action (what the user waited for next). */
  afterWaits?: WaitCondition[];
  /**
   * Optional node config carried from the recorder into the saved flow step. Used by
   * synthetic secure-session nodes (`reuseSession` → reuseSessionMode/reuseSessionId) and popup
   * bookkeeping (`closePopup` → popupAlias). Serialized verbatim by `buildRecordedFlow`.
   */
  config?: {
    popupAlias?: string;
    reuseSessionMode?: "autoDetect" | "selected";
    reuseSessionId?: string;
    [key: string]: unknown;
  };
  // ── Multi-Window / Popup ───────────────────────────────────────────────────
  /**
   * Which browser page this action was recorded on. `'main'` = initial recording page;
   * `'popup-1'`, `'popup-2'`, … = auto-assigned popup aliases. Absent for legacy actions.
   */
  pageAlias?: string;
  /**
   * True when this action (typically a click) opened a new popup/window immediately after
   * the click. The runner will arm `waitForEvent('popup')` before replaying this action.
   */
  opensPopup?: boolean;
  /**
   * Popup metadata captured at record time: alias, URL hints, title hints, load state.
   * Serialized as a plain object to avoid a hard dependency on FlowProfile in RecorderTypes.
   */
  popupExpectation?: {
    popupAlias: string;
    timeoutMs?: number;
    urlContains?: string;
    titleContains?: string;
    waitUntil?: "domcontentloaded" | "load" | "networkidle";
    closeBehavior?: "returnToMain" | "continueOnPopup";
  };
}

/**
 * Recorder protected-login / protected-popup handoff state.
 *
 * When the recorder detects a protected login / MFA / OTP / CAPTCHA / passkey / approval surface it
 * PAUSES, closes the automation browser, and enters this handoff so the user can complete the step
 * manually in their real Chrome. No secrets (passwords, OTPs, CAPTCHA values, cookies, tokens) are
 * ever captured or logged.
 */
export type RecorderHandoffPhase =
  | "detected"          // protected surface found; automation browser closed; awaiting the user
  | "capturingSession"  // real Chrome launched; user completing the manual login/approval
  | "sessionCaptured"   // session validated + secure nodes inserted
  | "resumed"           // Playwright relaunched with the saved session; recording continues
  | "error";            // a handoff step failed (see `error`)

export interface RecorderHandoffInfo {
  /** True while the user must act (detected / capturingSession); false once resumed/cancelled. */
  active: boolean;
  phase: RecorderHandoffPhase;
  /** Source page alias where the protection appeared: `main`, `popup-1`, … */
  sourceAlias: string;
  /** The detected protected URL (query secrets masked) — opened in the manual browser. */
  detectedUrl: string;
  /** Origin (protocol + host + port) of the detected URL. */
  origin: string;
  /** Detection reason (login-form / mfa / captcha / passkey / sso / …). */
  reason: string;
  /** Secret-free descriptions of what matched (e.g. "password field", "captcha iframe"). */
  signals: string[];
  /** ISO timestamp of detection. */
  timestamp: string;
  /** Recorder draft id (stable for one start→stop session), if available. */
  draftId?: string;
  /** Safe URL to resume recording at after capture (the original recording target). */
  resumeUrl?: string;
  /** Saved session profile id once capture starts. */
  sessionId?: string;
  /** Saved session display name. */
  sessionName?: string;
  /** User-facing message for the Recorder panel. */
  message: string;
  /** Populated when `phase === "error"`. */
  error?: string;
}

/** A URL captured during a recording session. Sensitive query values are masked before storage. */
export interface RecordedUrl {
  id: string;
  /** Full URL with sensitive query values masked (e.g. `?token=***`). */
  url: string;
  title?: string;
  /** ISO timestamp when the URL was recorded. */
  timestamp: string;
  /** Event/source type: manual_url_entry | navigation | new_tab | redirect. */
  source: string;
  /** Recording session id (stable for one start→stop session). */
  sessionId?: string;
}
