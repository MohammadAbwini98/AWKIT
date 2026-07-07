/**
 * Chromium no-egress hardening (Phase 5.1C).
 *
 * The Phase 5 packaged walkthrough found that every bundled-Chromium launch emits a short burst
 * of Google-service TCP connections (time.google.com / googleapis frontends) even under
 * Playwright's default switches. This module centralizes the extra launch flags that suppress
 * Chromium's background service calls WITHOUT touching page-level networking — navigation to
 * user-requested URLs (including Google sites) is unaffected.
 *
 * Env contract (documented in .env.example):
 *  - AWKIT_CHROMIUM_OFFLINE_HARDENING  — "false" disables the hardening args (default: enabled;
 *    AWKIT is offline-first, so suppressing browser phone-home is the correct default).
 *  - AWKIT_CHROMIUM_EXTRA_ARGS         — optional whitespace-separated extra Chromium switches,
 *    appended last (applies even when hardening is disabled).
 *
 * IMPORTANT — --disable-features is LAST-WINS in Chromium: Playwright passes its own
 * `--disable-features=<list>` and appends user args AFTER it, so any list we pass fully REPLACES
 * Playwright's. Our list must therefore be a SUPERSET of Playwright's defaults, or we would
 * silently re-enable MediaRouter/Translate/OptimizationHints/etc.
 */

/**
 * Playwright's own disabled-features list, mirrored from
 * node_modules/playwright-core (1.61, packages/…/chromium/chromiumSwitches.ts).
 * Re-check this list when upgrading Playwright.
 */
const PLAYWRIGHT_DISABLED_FEATURES = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "Translate",
  "AutoDeElevate",
  "RenderDocument",
  "OptimizationHints",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion"
];

/**
 * AWKIT additions — background services that phone Google infrastructure at/after launch.
 * Feature names verified against the bundled Chromium binary (strings in chrome.dll).
 */
const AWKIT_DISABLED_FEATURES = [
  // time.google.com clock-sync queries.
  "NetworkTimeServiceQuerying",
  // Autofill server round-trips.
  "AutofillServerCommunication",
  // CT log-list component fetches.
  "CertificateTransparencyComponentUpdater",
  // Default-search-engine preconnector (SearchEnginePreconnector).
  "SearchEnginePreconnect2",
  // Default-search-engine page prewarm — the netlog-verified source of the startup
  // GET https://www.google.com/ (PrewarmHttpDiskCacheManager / HttpDiskCachePrewarming).
  "PrewarmDefaultSearchEngine",
  "HttpDiskCachePrewarming",
  // Speculative TLS preconnect to the default search engine at startup — the netlog-verified
  // source of the residual www.google.com:443 socket (is_preconnect:true, "google.com same_site").
  "PreconnectToSearch",
  "PreconnectToSearchDesktop"
];

/**
 * Switches that suppress Chromium background/service networking. Several repeat Playwright
 * defaults on purpose: the hardening must hold even if a future Playwright version drops them,
 * and the full set self-documents AWKIT's no-egress posture. Boolean switch duplicates are
 * harmless to Chromium.
 */
const HARDENING_SWITCHES = [
  "--disable-background-networking",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-domain-reliability",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-pings",
  "--password-store=basic",
  "--use-mock-keychain",
  // Behavioral defaults Playwright 1.61 sets today; pinned here (not egress-related) so a future
  // Playwright that drops them can't silently change AWKIT automation behavior — e.g.
  // --disable-popup-blocking is load-bearing for the multi-window/popup flow feature.
  "--disable-background-timer-throttling",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  // Redirect Chromium's browser-INTERNAL Google service endpoints to loopback. These switches
  // only change where the browser's own identity/search-domain services talk
  // (accounts.google.com/ListAccounts, www.google.com/async/folae, …) — page navigation to the
  // real accounts.google.com / www.google.com is completely unaffected.
  "--gaia-url=https://127.0.0.1",
  "--lso-url=https://127.0.0.1",
  "--google-apis-url=https://127.0.0.1",
  "--oauth-account-manager-url=https://127.0.0.1",
  "--google-base-url=https://127.0.0.1"
];

/**
 * Browser-SERVICE hostnames resolved to loopback so their connections never leave the machine
 * (net-log-verified initiators of the Phase 5 egress: GCM push channel + check-in, component/
 * extension updates, variations, clock sync, safe-browsing lists, optimization hints).
 *
 * DELIBERATELY NOT LISTED (pages legitimately navigate to them — blocking would break real
 * automation, e.g. the protected-login detection flow on Google sign-in pages):
 * accounts.google.com, www.google.com, clients*.google.com content APIs, or any user-facing site.
 *
 * Side effect (accepted): FCM/web-push delivery is dead in AWKIT-owned automation browsers.
 */
const BLOCKED_SERVICE_HOSTS = [
  "mtalk.google.com",
  "*.mtalk.google.com",
  "android.clients.google.com",
  "clients2.google.com",
  "update.googleapis.com",
  "clientservices.googleapis.com",
  "optimizationguide-pa.googleapis.com",
  "safebrowsing.googleapis.com",
  "time.google.com",
  "redirector.gvt1.com",
  "edgedl.me.gvt1.com",
  "csp.withgoogle.com"
];

function hostResolverRules(): string {
  return BLOCKED_SERVICE_HOSTS.map((host) => `MAP ${host} 127.0.0.1`).join(", ");
}

export function isChromiumHardeningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AWKIT_CHROMIUM_OFFLINE_HARDENING !== "false";
}

function parseExtraArgs(env: NodeJS.ProcessEnv): string[] {
  return (env.AWKIT_CHROMIUM_EXTRA_ARGS ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Launch args for every AWKIT-owned bundled-Chromium launch (runner + recorder). NEVER apply
 * these to the user's real Chrome/Edge (SessionCaptureService) — the manual-login browser must
 * stay a plain, unflagged consumer browser.
 */
export function buildChromiumHardeningArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = parseExtraArgs(env);
  if (!isChromiumHardeningEnabled(env)) return extra;
  return [
    ...HARDENING_SWITCHES,
    `--disable-features=${[...PLAYWRIGHT_DISABLED_FEATURES, ...AWKIT_DISABLED_FEATURES].join(",")}`,
    `--host-resolver-rules=${hostResolverRules()}`,
    ...extra
  ];
}
