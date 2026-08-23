/**
 * SessionCaptureService — launches the user's real, installed Chrome/Edge browser (NOT
 * Playwright's automation-controlled Chromium) with a custom `--user-data-dir` so the user
 * can log into protected sites (Google, Microsoft, Cloudflare-gated) without being blocked
 * by automation detection.
 *
 * After the user logs in and closes the browser, the persistent profile retains cookies,
 * IndexedDB, Service Workers, localStorage — everything. Automation runs then use
 * `launchPersistentContext()` with the same profile directory.
 *
 * SAFETY: No CDP connection. No automation flags. No secrets logged. No stealth/anti-detection
 * code. The user authenticates manually in a completely normal browser window.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionProfile, SessionCaptureStatus, DetectedBrowser } from "./SessionProfile";
import { normalizeOrigin } from "./sessionMatch";
import { writeJsonFileAtomic } from "./atomicWrite";

/** Well-known Chrome/Edge installation paths on Windows. */
const BROWSER_CANDIDATES: { path: string; browser: "chrome" | "msedge" }[] = [
  { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", browser: "chrome" },
  { path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", browser: "chrome" },
  { path: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"), browser: "chrome" },
  { path: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", browser: "msedge" },
  { path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", browser: "msedge" },
  { path: join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "Application", "msedge.exe"), browser: "msedge" }
];

const PROFILES_METADATA_FILE = "session-profiles.json";

export class SessionCaptureService {
  /** Active capture process (only one at a time). */
  private activeProcess: ChildProcess | null = null;
  private activeStatus: SessionCaptureStatus = { active: false, status: "idle" };
  private activeSessionId: string | null = null;
  /** Serializes metadata writes so two rapid mutations cannot interleave and drop updates. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly profilesRoot: string) {
    mkdirSync(this.profilesRoot, { recursive: true });
  }

  // ─── Browser detection ────────────────────────────────────────────────

  detectBrowser(): DetectedBrowser {
    for (const candidate of BROWSER_CANDIDATES) {
      if (existsSync(candidate.path)) {
        return { found: true, path: candidate.path, browser: candidate.browser };
      }
    }
    return { found: false, path: "", browser: "unknown" };
  }

  // ─── Profile management ───────────────────────────────────────────────

  private metadataPath(): string {
    return join(this.profilesRoot, PROFILES_METADATA_FILE);
  }

  private async readProfiles(): Promise<SessionProfile[]> {
    let raw: string;
    try {
      raw = await readFile(this.metadataPath(), "utf8");
    } catch (error) {
      // AWKIT-SES-004: a MISSING file is a normal "no sessions yet"; any other read failure is
      // loud, not silently treated as an empty registry.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`[session-capture] Could not read ${this.metadataPath()}: ${(error as Error).message}`);
      }
      return [];
    }
    try {
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as SessionProfile[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      // AWKIT-SES-004: a malformed metadata file is NOT silently collapsed to [] — every later
      // mutation would write the truncated list back and make captured profiles unreachable.
      // Quarantine the bytes (JsonProfileStore.quarantineCorrupt pattern) and fail this read;
      // the profile DIRECTORIES survive on disk either way.
      await this.quarantineCorruptMetadata(error);
      throw new Error(
        `Session metadata ${PROFILES_METADATA_FILE} is corrupt; it was preserved as a .corrupt-* sibling. ` +
          `Restore or delete it before using captured sessions. (${(error as Error).message})`
      );
    }
  }

  /** Rename the unreadable metadata file aside so its bytes survive for recovery. */
  private async quarantineCorruptMetadata(error: unknown): Promise<void> {
    const source = this.metadataPath();
    const target = `${source}.corrupt-${Date.now()}`;
    try {
      await rename(source, target);
      console.error(
        `[session-capture] ${source} is not valid JSON; preserved as ${target} so it is not lost. ` +
          `Parse error: ${(error as Error).message}`
      );
    } catch (renameError) {
      console.error(
        `[session-capture] ${source} is not valid JSON and could not be quarantined ` +
          `(${(renameError as Error).message}); left in place. Parse error: ${(error as Error).message}`
      );
    }
  }

  /** Atomic metadata write. Callers MUST already hold the `enqueue` chain. */
  private writeProfiles(profiles: SessionProfile[]): Promise<void> {
    return writeJsonFileAtomic(this.metadataPath(), profiles);
  }

  /**
   * Serialize a read-modify-write metadata operation so concurrent mutations (a rename landing
   * while the capture-exit handler marks the profile ready) cannot silently drop one update.
   * The chain only tracks completion: a failed operation never blocks later ones.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation, operation);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<SessionProfile[]> {
    return this.enqueue(async () => {
      const profiles = await this.readProfiles();
      // Sync status: if a profile dir was deleted externally, mark it as error.
      let changed = false;
      for (const profile of profiles) {
        if (profile.status === "ready" && !existsSync(profile.profileDir)) {
          profile.status = "error";
          changed = true;
        }
        // Backfill origin/source for legacy profiles so origin-based matching works.
        if (!profile.origin && profile.targetUrl) {
          const origin = normalizeOrigin(profile.targetUrl);
          if (origin) {
            profile.origin = origin;
            changed = true;
          }
        }
        if (!profile.source) {
          profile.source = "manual";
          changed = true;
        }
        // If we're actively capturing for this profile, show capturing status.
        if (this.activeSessionId === profile.id && this.activeProcess) {
          profile.status = "capturing";
        }
      }
      if (changed) await this.writeProfiles(profiles);
      return profiles;
    });
  }

  async getById(id: string): Promise<SessionProfile | null> {
    const profiles = await this.readProfiles();
    return profiles.find((p) => p.id === id) ?? null;
  }

  async rename(id: string, newName: string): Promise<SessionProfile> {
    return this.enqueue(async () => {
      const profiles = await this.readProfiles();
      const profile = profiles.find((p) => p.id === id);
      if (!profile) throw new Error(`Session profile ${id} not found.`);
      profile.name = newName.trim() || profile.name;
      await this.writeProfiles(profiles);
      return profile;
    });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.enqueue(async () => {
      const profiles = await this.readProfiles();
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return;

      // Don't delete while capturing.
      if (this.activeSessionId === id && this.activeProcess) {
        throw new Error("Cannot delete a session that is currently being captured. Close the browser first.");
      }

      // Remove the profile directory (best-effort).
      try {
        if (existsSync(profile.profileDir)) {
          rmSync(profile.profileDir, { recursive: true, force: true });
        }
      } catch (error) {
        console.warn(`[session] Could not fully remove profile directory: ${profile.profileDir}`, error);
      }

      await this.writeProfiles(profiles.filter((p) => p.id !== id));
    });
  }

  /**
   * Best-effort check that a capture profile actually holds authenticated browser state (the user
   * completed a manual login). Chrome writes cookies/network state under `Default/` once the profile
   * has been used, so a profile dir with only the initial scaffolding is treated as "no session".
   * Never reads cookie/token values — only checks that state files exist.
   */
  hasCapturedData(id: string): boolean {
    const profileDir = join(this.profilesRoot, id);
    if (!existsSync(profileDir)) return false;
    const markers = [
      join(profileDir, "Default", "Network", "Cookies"),
      join(profileDir, "Default", "Cookies"),
      join(profileDir, "Default", "Local Storage"),
      join(profileDir, "Default", "Preferences")
    ];
    if (markers.some((marker) => existsSync(marker))) return true;
    // Fallback: a used profile has a populated `Default/` directory.
    try {
      const defaultDir = join(profileDir, "Default");
      return existsSync(defaultDir) && readdirSync(defaultDir).length > 0;
    } catch {
      return false;
    }
  }

  /** Mark a profile as used (update lastUsedAt). */
  async markUsed(id: string): Promise<void> {
    await this.enqueue(async () => {
      const profiles = await this.readProfiles();
      const profile = profiles.find((p) => p.id === id);
      if (profile) {
        profile.lastUsedAt = new Date().toISOString();
        await this.writeProfiles(profiles);
      }
    });
  }

  // ─── Capture flow ─────────────────────────────────────────────────────

  async startCapture(name: string, targetUrl: string, source: SessionProfile["source"] = "manual"): Promise<SessionCaptureStatus> {
    if (this.activeProcess) {
      throw new Error("A session capture is already in progress. Close the current browser window first.");
    }

    const browser = this.detectBrowser();
    if (!browser.found) {
      throw new Error(
        "No Chrome or Edge browser found on this system. Install Google Chrome or Microsoft Edge, " +
          "then try again. (SpecterStudio cannot use its bundled Chromium for session capture because " +
          "it would be detected as an automation browser.)"
      );
    }

    const safeName = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "session";
    const id = `session-${randomUUID().slice(0, 8)}`;
    const profileDir = join(this.profilesRoot, id);
    mkdirSync(profileDir, { recursive: true });

    // Register the profile in metadata (serialized with every other metadata mutation).
    const cleanUrl = targetUrl.trim() || undefined;
    const profile: SessionProfile = {
      id,
      name: name.trim() || safeName,
      profileDir,
      targetUrl: cleanUrl,
      loginUrl: cleanUrl,
      origin: normalizeOrigin(cleanUrl),
      source,
      createdAt: new Date().toISOString(),
      browserPath: browser.path,
      status: "capturing"
    };
    await this.enqueue(async () => {
      const profiles = await this.readProfiles();
      profiles.push(profile);
      await this.writeProfiles(profiles);
    });

    // Normalize URL: prepend https:// if bare host.
    let url = (targetUrl ?? "").trim();
    if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) && !/^(about:|data:|file:)/i.test(url)) {
      url = `https://${url}`;
    }
    // Only open http(s) (or about:) capture targets in the user's real browser; a file:/data:
    // target could open a local file in their browser (audit F-11).
    if (url && !/^https?:\/\//i.test(url) && !/^about:/i.test(url)) {
      throw new Error("Session capture only supports http(s) target URLs.");
    }

    // Launch the real Chrome/Edge with the custom user-data-dir.
    const args = [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      // Start with a reasonable window size.
      "--window-size=1280,900"
    ];
    if (url) args.push(url);

    this.activeSessionId = id;
    this.activeStatus = { active: true, sessionId: id, sessionName: profile.name, status: "launching" };

    try {
      const child = spawn(browser.path, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });

      this.activeProcess = child;
      this.activeStatus.browserPid = child.pid;
      this.activeStatus.status = "running";

      child.on("exit", () => {
        this.handleBrowserClosed(id);
      });

      child.on("error", (err) => {
        this.activeStatus = {
          active: false,
          sessionId: id,
          sessionName: profile.name,
          status: "error",
          error: err.message
        };
        this.activeProcess = null;
        this.activeSessionId = null;
        // Mark profile as error.
        void this.enqueue(async () => {
          const all = await this.readProfiles();
          const p = all.find((x) => x.id === id);
          if (p) {
            p.status = "error";
            await this.writeProfiles(all);
          }
        }).catch(console.error);
      });

      // Don't keep the parent process alive just because of the child.
      child.unref();

      return { ...this.activeStatus };
    } catch (error) {
      this.activeProcess = null;
      this.activeSessionId = null;
      this.activeStatus = { active: false, status: "error", error: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  private handleBrowserClosed(sessionId: string): void {
    this.activeProcess = null;
    this.activeSessionId = null;
    this.activeStatus = {
      active: false,
      sessionId,
      status: "closed"
    };

    // AWKIT-SES-003: the transition used to set `ready` UNCONDITIONALLY, so closing Chrome without
    // logging in produced a "ready" profile that Auto Secure Login's origin matching would bind to
    // (observed live: run 021e3a2f, session-a2b9c0c8). Fail closed instead — only profiles with
    // real authenticated browser state become ready.
    void this.enqueue(async () => {
      const profiles = await this.readProfiles();
      const profile = profiles.find((p) => p.id === sessionId);
      if (profile) {
        const usable = this.hasAuthenticatedState(sessionId);
        profile.status = usable ? "ready" : "error";
        if (!usable) {
          console.warn(
            `[session] Capture "${sessionId}" closed WITHOUT authenticated browser state (no cookies/local storage). ` +
              `Marked error so it can never satisfy Auto Secure Login's reuse match.`
          );
        }
        await this.writeProfiles(profiles);
      }
    }).catch(console.error);

    console.log(`[session] Browser closed. Session "${sessionId}" evaluated for reuse.`);
  }

  /**
   * AWKIT-SES-003: stronger than {@link hasCapturedData} — only signals that prove REAL
   * authenticated browsing state. Real Chrome writes `Default/Preferences` very early, so its
   * existence alone is weak and must never mark an abandoned capture as reusable.
   */
  private hasAuthenticatedState(sessionId: string): boolean {
    const profileDir = join(this.profilesRoot, sessionId);
    if (!existsSync(profileDir)) return false;
    const strongMarkers = [
      join(profileDir, "Default", "Network", "Cookies"),
      join(profileDir, "Default", "Cookies"),
      join(profileDir, "Default", "Local Storage")
    ];
    return strongMarkers.some((marker) => existsSync(marker));
  }

  getStatus(): SessionCaptureStatus {
    // If the process was killed externally, clean up.
    if (this.activeProcess && this.activeProcess.exitCode !== null) {
      if (this.activeSessionId) this.handleBrowserClosed(this.activeSessionId);
    }
    return { ...this.activeStatus };
  }

  /** Force-stop an active capture (kills the browser process). */
  stopCapture(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch {
        // Process may have already exited.
      }
    }
  }
}
