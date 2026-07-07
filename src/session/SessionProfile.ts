/**
 * Session profile types for the Session Capture Browser feature.
 *
 * A session profile represents a persistent Chrome user-data directory where the user
 * has manually authenticated. Automation runs reuse the profile via Playwright's
 * `launchPersistentContext()` with the profile's `profileDir` as `userDataDir`.
 */

export interface SessionProfile {
  id: string;
  /** User-chosen display name, e.g. "Google Work Account". */
  name: string;
  /** Absolute path to the Chrome `--user-data-dir`. */
  profileDir: string;
  /** URL opened when the session was first captured. */
  targetUrl?: string;
  /** The login URL used for capture (may differ from targetUrl); defaults to targetUrl. */
  loginUrl?: string;
  /** Normalized origin (protocol + host + port) used for session matching. */
  origin?: string;
  /** How this session was created. Older profiles have no source (treat as "manual"). */
  source?: "autoSecureLogin" | "manual" | "imported" | "manualChromeHandoff";
  createdAt: string;
  lastUsedAt?: string;
  /** Path to the Chrome / Edge executable used during capture. */
  browserPath?: string;
  status: "ready" | "capturing" | "error";
}

export interface SessionCaptureStatus {
  active: boolean;
  sessionId?: string;
  sessionName?: string;
  browserPid?: number;
  status: "idle" | "launching" | "running" | "closed" | "error";
  error?: string;
}

export interface DetectedBrowser {
  found: boolean;
  path: string;
  browser: "chrome" | "msedge" | "unknown";
}
