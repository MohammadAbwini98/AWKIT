/**
 * Browser Runtime Configuration Resolver (Browser Resource Optimization architecture — Phase 8).
 *
 * THE single authoritative place that turns a declarative `BrowserResourceProfile` + a workflow's
 * `WorkflowCapabilities` + machine facts + environment escape-hatches into the concrete Playwright inputs:
 *
 *     BrowserResourceProfile + WorkflowCapabilities + Machine + Env
 *                              ↓
 *          resolveBrowserRuntimeConfiguration()
 *                              ↓
 *      { resourceRouting, launchArgOverrides, artifact, pageCleanup, contextOverrides, diagnostics }
 *
 * Every decision records a diagnostic `{ setting, value, source }` so production troubleshooting can see
 * WHY a knob ended up where it did (profile vs. workflow capability vs. env override).
 *
 * SAFETY: capabilities only ever RELAX optimizations. The `balanced` profile with no env overrides
 * resolves to today's exact behaviour (normal routing, no launch-arg deltas, throttling untouched,
 * trace onFailure). Pure — no I/O, no browser. Verified by `verify:browser-resource-profile`.
 */
import {
  loadResourceRoutingConfig,
  profileDefaults,
  type ResourceRoutingConfig
} from "../ResourceRoutingPolicy";
import { resolveArtifactSettings, type ArtifactProfile, type ArtifactSettings } from "../artifacts/ArtifactProfile";
import type { TraceMode } from "../artifacts/TraceService";
import {
  resourceRoutingProfileFor,
  type BrowserResourceProfile
} from "./BrowserResourceProfile";
import type { WorkflowCapabilities } from "./WorkflowCapabilities";

/** One resolved setting and the reason it landed where it did (for the diagnostic explain output). */
export interface ResolutionDiagnostic {
  setting: string;
  value: string;
  source: string;
}

/** Playwright default switches that must be dropped (via `ignoreDefaultArgs`) to re-enable throttling. */
export const BACKGROUND_THROTTLING_DEFAULT_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding"
];

/**
 * Well-known third-party analytics / advertising / telemetry hosts. Blocking these never changes an
 * application's own behaviour (they are fire-and-forget beacons) but removes network + CPU + RAM. Kept
 * deliberately small and famous — first-party hosts and functional CDNs are NOT here. `*` globs.
 */
export const KNOWN_ANALYTICS_URL_PATTERNS = [
  "*google-analytics.com*",
  "*googletagmanager.com*",
  "*doubleclick.net*",
  "*google-analytics*",
  "*/collect?*",
  "*segment.io*",
  "*segment.com/v1*",
  "*mixpanel.com*",
  "*amplitude.com*",
  "*hotjar.com*",
  "*fullstory.com*",
  "*scorecardresearch.com*",
  "*quantserve.com*",
  "*connect.facebook.net*",
  "*facebook.com/tr*",
  "*bat.bing.com*",
  "*clarity.ms*"
];

/** Launch-argument deltas the factory folds into `createLaunchOptions`. Never removes ALL defaults. */
export interface LaunchArgOverrides {
  /** Extra Chromium switches appended after the hardening args. */
  add: string[];
  /** Specific Playwright default switches to drop (never `ignoreDefaultArgs: true`). */
  ignoreDefaultArgs: string[];
  /**
   * When true, `buildChromiumHardeningArgs` must NOT re-pin `--disable-background-timer-throttling`
   * (otherwise it would undo the `ignoreDefaultArgs` drop and keep throttling disabled).
   */
  omitBackgroundTimerThrottlePin: boolean;
}

/** Context-option overrides not already carried by `ResourceRoutingConfig` (viewport/scale live here). */
export interface ContextOverrides {
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
}

export interface ResolvedBrowserRuntimeConfiguration {
  profileMode: BrowserResourceProfile["mode"];
  resourceRouting: ResourceRoutingConfig;
  launchArgOverrides: LaunchArgOverrides;
  artifactProfile: ArtifactProfile;
  artifact: ArtifactSettings;
  /** Effective trace mode after honouring an explicit `AWKIT_TRACE_MODE` env override (back-compat). */
  traceMode: TraceMode;
  contextOverrides: ContextOverrides;
  pageCleanup: { enabled: boolean };
  diagnostics: ResolutionDiagnostic[];
}

export interface ResolveInput {
  profile: BrowserResourceProfile;
  capabilities: WorkflowCapabilities;
  machine?: { logicalCpuCount?: number };
  env?: NodeJS.ProcessEnv;
}

function pushGpuArgs(profile: BrowserResourceProfile, caps: WorkflowCapabilities, add: string[], diags: ResolutionDiagnostic[]): void {
  if (caps.needsGpu || caps.needsWebGL) {
    if (profile.gpu.mode !== "auto") {
      diags.push({ setting: "gpu", value: "auto", source: "WorkflowCapability:needsGpu/needsWebGL (override)" });
    }
    return;
  }
  if (profile.gpu.mode === "reduced") {
    add.push("--disable-gpu-compositing");
    diags.push({ setting: "gpu", value: "reduced (--disable-gpu-compositing)", source: `${profile.mode}Profile` });
  } else if (profile.gpu.mode === "disabled") {
    add.push("--disable-gpu");
    diags.push({ setting: "gpu", value: "disabled (--disable-gpu)", source: `${profile.mode}Profile` });
  }
}

function pushWebglArgs(profile: BrowserResourceProfile, caps: WorkflowCapabilities, add: string[], diags: ResolutionDiagnostic[]): void {
  if (profile.webgl.enabled) return;
  if (caps.needsWebGL) {
    diags.push({ setting: "webgl", value: "enabled", source: "WorkflowCapability:needsWebGL (override)" });
    return;
  }
  add.push("--disable-webgl");
  diags.push({ setting: "webgl", value: "disabled (--disable-webgl)", source: `${profile.mode}Profile` });
}

/**
 * Resolve the concrete runtime configuration. Deterministic and total.
 */
export function resolveBrowserRuntimeConfiguration(input: ResolveInput): ResolvedBrowserRuntimeConfiguration {
  const { profile, capabilities: caps } = input;
  const env = input.env ?? process.env;
  const diagnostics: ResolutionDiagnostic[] = [];
  const source = `${profile.mode}Profile`;

  // ── Request routing (image/media/font/stylesheet blocking + analytics + escape hatches) ──────────
  const routingProfile = resourceRoutingProfileFor(profile);
  const profileBlocked = new Set(profileDefaults(routingProfile).blockResourceTypes);

  // Capabilities re-allow blocked sub-resources the workflow provably needs.
  const allowResourceTypes: string[] = [];
  if (caps.needsImages && profileBlocked.has("image")) {
    allowResourceTypes.push("image");
    diagnostics.push({ setting: "blockImages", value: "false", source: "WorkflowCapability:needsImages" });
  }
  if (caps.needsMedia && profileBlocked.has("media")) {
    allowResourceTypes.push("media");
    diagnostics.push({ setting: "blockMedia", value: "false", source: "WorkflowCapability:needsMedia" });
  }
  if (profile.resources.blockImages && !caps.needsImages) {
    diagnostics.push({ setting: "blockImages", value: "true", source });
  }

  const blockUrlPatterns: string[] = [];
  if (profile.resources.blockAnalytics) {
    blockUrlPatterns.push(...KNOWN_ANALYTICS_URL_PATTERNS);
    diagnostics.push({ setting: "blockAnalytics", value: "true", source });
  }

  // Env escape hatches still apply (operator force-allow/deny) — additive, never widening blocking beyond
  // what the profile + analytics list chose.
  const envRouting = loadResourceRoutingConfig(env);
  const resourceRouting: ResourceRoutingConfig = {
    profile: routingProfile,
    blockResourceTypes: [...envRouting.blockResourceTypes.filter((t) => !profileBlocked.has(t))],
    allowResourceTypes: dedupe([...allowResourceTypes, ...envRouting.allowResourceTypes]),
    allowUrlPatterns: dedupe([...envRouting.allowUrlPatterns]),
    blockUrlPatterns: dedupe([...blockUrlPatterns, ...envRouting.blockUrlPatterns]),
    blockServiceWorkers: false, // decided below
    acceptDownloads: true, // decided below
    reducedMotion: false, // decided below
    deviceScaleFactor: undefined, // decided below
    debug: envRouting.debug
  };

  // ── Service workers ───────────────────────────────────────────────────────────────────────────
  if (profile.serviceWorkers === "block" && !caps.needsServiceWorkers) {
    resourceRouting.blockServiceWorkers = true;
    diagnostics.push({ setting: "serviceWorkers", value: "block", source });
  } else if (profile.serviceWorkers === "block" && caps.needsServiceWorkers) {
    diagnostics.push({ setting: "serviceWorkers", value: "allow", source: "WorkflowCapability:needsServiceWorkers" });
  }

  // ── Reduced motion ────────────────────────────────────────────────────────────────────────────
  if (profile.reducedMotion && !caps.needsAnimations) {
    resourceRouting.reducedMotion = true;
    diagnostics.push({ setting: "reducedMotion", value: "reduce", source });
  } else if (profile.reducedMotion && caps.needsAnimations) {
    diagnostics.push({ setting: "reducedMotion", value: "no-preference", source: "WorkflowCapability:needsAnimations" });
  }

  // ── Downloads ─────────────────────────────────────────────────────────────────────────────────
  resourceRouting.acceptDownloads = profile.acceptDownloads || caps.needsDownloads;
  if (!profile.acceptDownloads && caps.needsDownloads) {
    diagnostics.push({ setting: "acceptDownloads", value: "true", source: "WorkflowCapability:needsDownloads" });
  }

  // ── Device scale / viewport ─────────────────────────────────────────────────────────────────
  let deviceScaleFactor = profile.viewport.deviceScaleFactor;
  if (deviceScaleFactor !== undefined && caps.needsFullResolution) {
    diagnostics.push({ setting: "deviceScaleFactor", value: "default", source: "WorkflowCapability:needsFullResolution" });
    deviceScaleFactor = undefined;
  } else if (deviceScaleFactor !== undefined) {
    diagnostics.push({ setting: "deviceScaleFactor", value: String(deviceScaleFactor), source });
  }
  // Env override for device scale (existing AWKIT_DEVICE_SCALE_FACTOR contract) still wins when set.
  if (env.AWKIT_DEVICE_SCALE_FACTOR !== undefined && Number.isFinite(Number.parseFloat(env.AWKIT_DEVICE_SCALE_FACTOR))) {
    deviceScaleFactor = Number.parseFloat(env.AWKIT_DEVICE_SCALE_FACTOR);
    diagnostics.push({ setting: "deviceScaleFactor", value: String(deviceScaleFactor), source: "env:AWKIT_DEVICE_SCALE_FACTOR" });
  }
  resourceRouting.deviceScaleFactor = deviceScaleFactor;

  // ── Launch-arg deltas (background throttling / gpu / webgl / cache) ─────────────────────────────
  const add: string[] = [];
  const ignoreDefaultArgs: string[] = [];
  let omitBackgroundTimerThrottlePin = false;

  if (profile.backgroundThrottling.enabled) {
    ignoreDefaultArgs.push(...BACKGROUND_THROTTLING_DEFAULT_ARGS);
    omitBackgroundTimerThrottlePin = true;
    diagnostics.push({ setting: "backgroundThrottling", value: "enabled", source });
  } else {
    diagnostics.push({ setting: "backgroundThrottling", value: "disabled", source });
  }

  pushGpuArgs(profile, caps, add, diagnostics);
  pushWebglArgs(profile, caps, add, diagnostics);

  if (profile.cache.mode === "bounded" && profile.cache.maxSizeBytes && profile.cache.maxSizeBytes > 0) {
    add.push(`--disk-cache-size=${Math.floor(profile.cache.maxSizeBytes)}`);
    diagnostics.push({ setting: "cache", value: `bounded (${Math.floor(profile.cache.maxSizeBytes)} bytes)`, source });
  }

  const launchArgOverrides: LaunchArgOverrides = { add, ignoreDefaultArgs, omitBackgroundTimerThrottlePin };

  // ── Artifacts (trace / failure screenshot / video), honouring the AWKIT_TRACE_MODE back-compat env ──
  const artifactProfile: ArtifactProfile = profile.artifacts.profile;
  const artifact = resolveArtifactSettings(artifactProfile);
  const traceEnv = (env.AWKIT_TRACE_MODE ?? "").toLowerCase();
  let traceMode: TraceMode = artifact.traceMode;
  if (traceEnv === "off" || traceEnv === "always" || traceEnv === "onfailure") {
    traceMode = traceEnv === "onfailure" ? "onFailure" : (traceEnv as TraceMode);
    diagnostics.push({ setting: "traceMode", value: traceMode, source: "env:AWKIT_TRACE_MODE" });
  } else {
    diagnostics.push({ setting: "traceMode", value: traceMode, source: `${source}:artifacts=${artifactProfile}` });
  }

  // ── Page cleanup ────────────────────────────────────────────────────────────────────────────
  const pageCleanupEnabled = profile.pageCleanup.enabled && !caps.needsMultiplePages;
  if (profile.pageCleanup.enabled && caps.needsMultiplePages) {
    diagnostics.push({ setting: "pageCleanup", value: "disabled", source: "WorkflowCapability:needsMultiplePages" });
  } else if (profile.pageCleanup.enabled) {
    diagnostics.push({ setting: "pageCleanup", value: "enabled", source });
  }

  return {
    profileMode: profile.mode,
    resourceRouting,
    launchArgOverrides,
    artifactProfile,
    artifact,
    traceMode,
    contextOverrides: { viewport: { width: profile.viewport.width, height: profile.viewport.height }, deviceScaleFactor },
    pageCleanup: { enabled: pageCleanupEnabled },
    diagnostics
  };
}

/** Human-readable one-line-per-decision explanation (the Phase 8 diagnostic output). */
export function explainResolution(resolved: ResolvedBrowserRuntimeConfiguration): string[] {
  return [
    `profile=${resolved.profileMode}`,
    ...resolved.diagnostics.map((d) => `${d.setting}=${d.value}\n  source=${d.source}`)
  ];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
