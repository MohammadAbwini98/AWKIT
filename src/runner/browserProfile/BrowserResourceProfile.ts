/**
 * Browser Resource Profiles (Browser Resource Optimization architecture).
 *
 * A single high-level description of how aggressively ONE Chromium automation instance should trade
 * fidelity for cost. It does NOT contain Playwright/Chromium mechanics — those are derived later by
 * `BrowserRuntimeConfigurationResolver` (which composes the existing `ResourceRoutingPolicy` and
 * `ArtifactProfile` low-level knobs plus launch-arg deltas). Keeping this layer declarative means the
 * profile can be reasoned about, diffed, and unit-tested without a browser.
 *
 * Three named presets + Custom:
 *   - `maximum-compatibility` — never block or throttle anything; safest for unknown sites.
 *   - `balanced`              — TODAY'S EXACT BEHAVIOUR (the default). No request blocking, background
 *                               throttling left disabled (as Playwright ships it), balanced artifacts.
 *   - `low-resource`          — block image/media/font, block service workers, reduced motion, fixed
 *                               device-scale, RE-ENABLE Chromium background throttling, leanest artifacts,
 *                               idle page cleanup, bounded disk cache.
 *   - `custom`                — operator-assembled; every field explicit.
 *
 * CRITICAL SAFETY INVARIANT: `balanced` must resolve to the same runtime configuration AWKIT produced
 * before this architecture existed. Verified by `verify:browser-resource-profile`.
 *
 * See docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md.
 */
import type { ResourceProfile } from "../ResourceRoutingPolicy";
import type { ArtifactProfile } from "../artifacts/ArtifactProfile";

export type BrowserResourceProfileMode = "maximum-compatibility" | "balanced" | "low-resource" | "custom";

/** GPU handling. `auto` = leave Chromium's default (today); `reduced` = disable GPU compositing only. */
export type GpuMode = "auto" | "reduced" | "disabled";

export interface BrowserResourceProfile {
  mode: BrowserResourceProfileMode;
  /** Request-blocking family — maps directly onto the existing `ResourceRoutingPolicy` profiles. */
  resources: {
    blockImages: boolean;
    blockMedia: boolean;
    blockFonts: boolean;
    blockStylesheets: boolean;
    /** Block known analytics/advertising/telemetry third-party hosts by URL pattern. */
    blockAnalytics: boolean;
  };
  serviceWorkers: "allow" | "block";
  reducedMotion: boolean;
  /**
   * `enabled: true` means ALLOW Chromium to throttle background/occluded work (the resource-saving
   * direction — AWKIT/Playwright disable it today). See resolver notes on `ignoreDefaultArgs`.
   */
  backgroundThrottling: { enabled: boolean };
  gpu: { mode: GpuMode };
  webgl: { enabled: boolean };
  artifacts: {
    /** Maps onto the existing `ArtifactProfile` (production/balanced/debug/full). */
    profile: ArtifactProfile;
  };
  viewport: {
    width: number;
    height: number;
    /** `undefined` leaves the Playwright default (today's behaviour for the non-lean profiles). */
    deviceScaleFactor?: number;
  };
  cache: {
    mode: "default" | "bounded";
    maxSizeBytes?: number;
  };
  /** Close idle/temporary pages the workflow no longer owns (never the active/workflow-owned page). */
  pageCleanup: { enabled: boolean };
  /** Accept downloads. Derived from capabilities at resolve time; the base preset seeds it. */
  acceptDownloads: boolean;
}

/** AWKIT's historical default viewport for a run (see resolveInstanceTemplate / InstanceManager). */
export const DEFAULT_VIEWPORT = { width: 1365, height: 768 } as const;

/** A conservative bounded disk-cache size for the low-resource profile (64 MiB). Never zero. */
export const LOW_RESOURCE_DISK_CACHE_BYTES = 64 * 1024 * 1024;

/** Map a Browser Resource Profile's blocking flags to the low-level `ResourceRoutingPolicy` profile. */
export function resourceRoutingProfileFor(profile: BrowserResourceProfile): ResourceProfile {
  const { blockImages, blockMedia, blockFonts, blockStylesheets } = profile.resources;
  if (blockStylesheets && blockImages) return "ultraLean";
  if (blockImages || blockMedia || blockFonts) return "lean";
  return "normal";
}

/**
 * The named presets. `balanced` is the historical default and MUST equal today's behaviour. Every field
 * is a declarative seed; the resolver later relaxes optimizations that a workflow's capabilities require.
 */
export function resolveBrowserResourceProfile(mode: BrowserResourceProfileMode): BrowserResourceProfile {
  const base: BrowserResourceProfile = {
    mode,
    resources: { blockImages: false, blockMedia: false, blockFonts: false, blockStylesheets: false, blockAnalytics: false },
    serviceWorkers: "allow",
    reducedMotion: false,
    backgroundThrottling: { enabled: false },
    gpu: { mode: "auto" },
    webgl: { enabled: true },
    artifacts: { profile: "balanced" },
    viewport: { ...DEFAULT_VIEWPORT },
    cache: { mode: "default" },
    pageCleanup: { enabled: false },
    acceptDownloads: true
  };

  switch (mode) {
    case "maximum-compatibility":
      // Identical to balanced today, but semantically pinned: NEVER block/throttle even if a custom env
      // layer would. Kept distinct so a workflow author can force the safest posture explicitly.
      return { ...base, mode };
    case "low-resource":
      return {
        ...base,
        mode,
        resources: { blockImages: true, blockMedia: true, blockFonts: true, blockStylesheets: false, blockAnalytics: true },
        serviceWorkers: "block",
        reducedMotion: true,
        // Background throttling is DISABLED here on measured evidence: the 20-rep occlusion experiment
        // (scripts/benchmark-occlusion.mts) showed re-enabling the three throttle switches yields NO CPU
        // reduction for AWKIT instances — Playwright keeps automated pages `visibilityState:visible` (so
        // page timers never throttle) and minimizing a window already stops the compositor (rAF 60→1/s) in
        // the current default. The switches only add launch-arg complexity for zero benefit. The mechanism
        // stays available in `custom` for operators who want to experiment. See BROWSER_RESOURCE_OPTIMIZATION.md §7.
        backgroundThrottling: { enabled: false },
        gpu: { mode: "auto" }, // NOT disabled by default — disabling GPU is Custom-only pending benchmark evidence
        webgl: { enabled: true }, // left on — WebGL usage is hard to prove absent; Custom can disable it
        artifacts: { profile: "production" },
        viewport: { ...DEFAULT_VIEWPORT, deviceScaleFactor: 1 },
        cache: { mode: "bounded", maxSizeBytes: LOW_RESOURCE_DISK_CACHE_BYTES },
        pageCleanup: { enabled: true },
        acceptDownloads: true
      };
    case "custom":
    case "balanced":
    default:
      return { ...base, mode: mode === "custom" ? "custom" : "balanced" };
  }
}

/** Parse an operator-supplied mode string (offline-safe; default balanced == today). */
export function parseBrowserResourceProfileMode(raw: string | undefined): BrowserResourceProfileMode {
  const v = (raw ?? "").toLowerCase().replace(/[\s_]/g, "-");
  if (v === "maximum-compatibility" || v === "max-compatibility" || v === "max") return "maximum-compatibility";
  if (v === "low-resource" || v === "low" || v === "lean") return "low-resource";
  if (v === "custom") return "custom";
  return "balanced";
}
