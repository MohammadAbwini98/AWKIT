/**
 * Resource-reduction routing policy (Concurrency Capacity plan — Phase A9).
 *
 * Cuts per-instance cost by ABORTING expensive sub-resource requests (images / media / fonts /
 * stylesheets) via `context.route`, plus deterministic context options (blocked service workers,
 * reduced motion, fixed device-scale, download opt-out) for non-visual runs. Three profiles:
 *
 *   - `normal`     — allow everything (today's exact behaviour; the default).
 *   - `lean`       — abort image / media / font; block service workers; reduced motion.
 *   - `ultraLean`  — also abort stylesheet; opt out of downloads.
 *
 * **Images are NEVER blocked by default** — only when a Lean profile is explicitly selected, and an
 * app that needs a specific asset can force-allow it by URL pattern. Every knob is env-overridable
 * (offline-safe) and the decision core is pure so it unit-tests without a browser.
 *
 * See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §A9.
 */
import type { BrowserContext } from "playwright";

export type ResourceProfile = "normal" | "lean" | "ultraLean";

export interface ResourceRoutingConfig {
  profile: ResourceProfile;
  /** Resource types aborted IN ADDITION to the profile defaults. */
  blockResourceTypes: string[];
  /** Resource types force-allowed even when the profile would abort them (compatibility escape hatch). */
  allowResourceTypes: string[];
  /** URL patterns (`*` wildcard) force-allowed regardless of resource type. */
  allowUrlPatterns: string[];
  /** URL patterns (`*` wildcard) force-aborted regardless of resource type. */
  blockUrlPatterns: string[];
  /** Block service workers on the context (`serviceWorkers: "block"`). */
  blockServiceWorkers: boolean;
  /** Accept downloads — opt-out in ultraLean. Default true preserves today's behaviour. */
  acceptDownloads: boolean;
  /** Force `reducedMotion: "reduce"` for deterministic, cheaper non-visual runs. */
  reducedMotion: boolean;
  /** Deterministic device-scale factor (1 for lean modes); undefined leaves the Playwright default. */
  deviceScaleFactor?: number;
  /** Log every abort decision (noisy — debugging only). */
  debug: boolean;
}

/** Per-profile seed values. Everything here is a configurable default, superseded by env/overrides. */
export function profileDefaults(profile: ResourceProfile): ResourceRoutingConfig {
  const base: ResourceRoutingConfig = {
    profile,
    blockResourceTypes: [],
    allowResourceTypes: [],
    allowUrlPatterns: [],
    blockUrlPatterns: [],
    blockServiceWorkers: false,
    acceptDownloads: true,
    reducedMotion: false,
    deviceScaleFactor: undefined,
    debug: false
  };
  if (profile === "lean") {
    return { ...base, blockResourceTypes: ["image", "media", "font"], blockServiceWorkers: true, reducedMotion: true, deviceScaleFactor: 1 };
  }
  if (profile === "ultraLean") {
    return {
      ...base,
      blockResourceTypes: ["image", "media", "font", "stylesheet"],
      blockServiceWorkers: true,
      reducedMotion: true,
      deviceScaleFactor: 1,
      acceptDownloads: false
    };
  }
  return base; // normal
}

export interface RequestDecision {
  action: "allow" | "abort";
  reason?: string;
}

/** Case-insensitive `*`-glob match against a full URL. No `*` means substring containment. */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!pattern) return false;
  const u = url.toLowerCase();
  const p = pattern.toLowerCase();
  if (!p.includes("*")) return u.includes(p);
  // Translate the glob to a regex, escaping regex metachars other than our `*`.
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(u);
  } catch {
    return u.includes(p.replace(/\*/g, ""));
  }
}

/**
 * Decide whether one request should proceed. Precedence: explicit URL allow > explicit URL block >
 * resource-type block (profile defaults ∪ extra, minus allow) > allow. Pure and total.
 */
export function decideRequest(resourceType: string, url: string, config: ResourceRoutingConfig): RequestDecision {
  if (config.allowUrlPatterns.some((p) => matchesUrlPattern(url, p))) {
    return { action: "allow", reason: "url-allow" };
  }
  if (config.blockUrlPatterns.some((p) => matchesUrlPattern(url, p))) {
    return { action: "abort", reason: "url-block" };
  }
  const allow = new Set(config.allowResourceTypes.map((t) => t.toLowerCase()));
  if (allow.has(resourceType.toLowerCase())) return { action: "allow", reason: "type-allow" };

  const block = new Set([...profileDefaults(config.profile).blockResourceTypes, ...config.blockResourceTypes].map((t) => t.toLowerCase()));
  // Extra blocks from config apply even in "normal" (opt-in); profile defaults only for lean/ultraLean.
  if (block.has(resourceType.toLowerCase())) return { action: "abort", reason: `type:${resourceType}` };

  return { action: "allow" };
}

/** True when any request-level routing is in effect — i.e. `context.route` needs installing. */
export function isRoutingActive(config: ResourceRoutingConfig): boolean {
  return (
    profileDefaults(config.profile).blockResourceTypes.length > 0 ||
    config.blockResourceTypes.length > 0 ||
    config.blockUrlPatterns.length > 0
  );
}

/** Playwright `newContext` / `launchPersistentContext` option overrides derived from the profile. */
export interface ResourceContextOptions {
  acceptDownloads: boolean;
  serviceWorkers?: "allow" | "block";
  reducedMotion?: "reduce" | "no-preference";
  deviceScaleFactor?: number;
}

export function resolveContextOptions(config: ResourceRoutingConfig): ResourceContextOptions {
  const options: ResourceContextOptions = { acceptDownloads: config.acceptDownloads };
  if (config.blockServiceWorkers) options.serviceWorkers = "block";
  if (config.reducedMotion) options.reducedMotion = "reduce";
  if (config.deviceScaleFactor !== undefined) options.deviceScaleFactor = config.deviceScaleFactor;
  return options;
}

function envList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function parseProfile(raw: string | undefined): ResourceProfile {
  const v = (raw ?? "").toLowerCase().replace(/[-_\s]/g, "");
  if (v === "lean") return "lean";
  if (v === "ultralean") return "ultraLean";
  return "normal";
}

/**
 * Build the effective routing config from environment (offline-safe; no remote config). Starts from the
 * profile defaults and layers explicit env overrides on top. Default profile is `normal` → no behaviour
 * change unless the operator opts in.
 */
export function loadResourceRoutingConfig(env: NodeJS.ProcessEnv = process.env): ResourceRoutingConfig {
  const profile = parseProfile(env.AWKIT_RESOURCE_PROFILE);
  const defaults = profileDefaults(profile);
  const scaleRaw = env.AWKIT_DEVICE_SCALE_FACTOR;
  const scale = scaleRaw !== undefined && Number.isFinite(Number.parseFloat(scaleRaw)) ? Number.parseFloat(scaleRaw) : defaults.deviceScaleFactor;
  return {
    profile,
    blockResourceTypes: [...defaults.blockResourceTypes, ...envList(env.AWKIT_BLOCK_RESOURCE_TYPES)],
    allowResourceTypes: envList(env.AWKIT_ALLOW_RESOURCE_TYPES),
    allowUrlPatterns: envList(env.AWKIT_ALLOW_URL_PATTERNS),
    blockUrlPatterns: envList(env.AWKIT_BLOCK_URL_PATTERNS),
    blockServiceWorkers: envBool(env.AWKIT_BLOCK_SERVICE_WORKERS, defaults.blockServiceWorkers),
    acceptDownloads: envBool(env.AWKIT_ACCEPT_DOWNLOADS, defaults.acceptDownloads),
    reducedMotion: envBool(env.AWKIT_REDUCED_MOTION, defaults.reducedMotion),
    deviceScaleFactor: scale,
    debug: envBool(env.AWKIT_RESOURCE_ROUTING_DEBUG, false)
  };
}

/**
 * Install request routing on a live context. No-op when routing isn't active (normal profile, no extra
 * blocks) so the fast path is untouched. Best-effort: a routing failure logs and lets the request proceed
 * rather than breaking the run.
 */
export async function installResourceRouting(
  context: BrowserContext,
  config: ResourceRoutingConfig,
  log: (message: string) => void = (m) => console.log(`[resource-routing] ${m}`)
): Promise<void> {
  if (!isRoutingActive(config)) return;
  await context.route("**/*", async (route) => {
    try {
      const request = route.request();
      const decision = decideRequest(request.resourceType(), request.url(), config);
      if (decision.action === "abort") {
        if (config.debug) log(`abort ${request.resourceType()} ${request.url()} (${decision.reason})`);
        await route.abort();
        return;
      }
      await route.continue();
    } catch {
      // Never let a routing hiccup break the page — fall through to the request proceeding.
      await route.continue().catch(() => undefined);
    }
  });
}
