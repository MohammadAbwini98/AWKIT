// Verifies the resource-reduction routing policy (src/runner/ResourceRoutingPolicy.ts) and artifact
// profiles (src/runner/artifacts/ArtifactProfile.ts): per-profile request decisions, URL allow/block
// precedence, extra/allow resource-type overrides, context-option resolution, env parsing, and the
// artifact-profile → trace/screenshot/video mapping. Pure — no browser. Run: npx tsx scripts/verify-resource-routing.mts
import {
  profileDefaults,
  decideRequest,
  resolveContextOptions,
  isRoutingActive,
  matchesUrlPattern,
  loadResourceRoutingConfig,
  type ResourceRoutingConfig
} from "../src/runner/ResourceRoutingPolicy";
import {
  resolveArtifactSettings,
  parseArtifactProfile,
  loadArtifactProfile
} from "../src/runner/artifacts/ArtifactProfile";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

function main() {
  // 1. Normal allows everything (no behavior change) and installs no routing.
  {
    const c = profileDefaults("normal");
    check("normal allows image", decideRequest("image", "http://x/y.png", c).action === "allow");
    check("normal allows stylesheet", decideRequest("stylesheet", "http://x/y.css", c).action === "allow");
    check("normal accepts downloads", c.acceptDownloads === true);
    check("normal is not routing-active (no context.route)", isRoutingActive(c) === false);
    check("normal has no service-worker block / reduced motion", c.blockServiceWorkers === false && c.reducedMotion === false);
  }

  // 2. Lean aborts image/media/font, keeps document/script/stylesheet; blocks SW + reduces motion.
  {
    const c = profileDefaults("lean");
    check("lean aborts image", decideRequest("image", "http://x/a.png", c).action === "abort");
    check("lean aborts media", decideRequest("media", "http://x/a.mp4", c).action === "abort");
    check("lean aborts font", decideRequest("font", "http://x/a.woff2", c).action === "abort");
    check("lean keeps stylesheet", decideRequest("stylesheet", "http://x/a.css", c).action === "allow");
    check("lean keeps document", decideRequest("document", "http://x/", c).action === "allow");
    check("lean keeps script", decideRequest("script", "http://x/a.js", c).action === "allow");
    check("lean is routing-active", isRoutingActive(c) === true);
    check("lean blocks service workers + reduces motion + scale 1", c.blockServiceWorkers && c.reducedMotion && c.deviceScaleFactor === 1);
  }

  // 3. Ultra-Lean also aborts stylesheet and opts out of downloads.
  {
    const c = profileDefaults("ultraLean");
    check("ultraLean aborts stylesheet", decideRequest("stylesheet", "http://x/a.css", c).action === "abort");
    check("ultraLean aborts image", decideRequest("image", "http://x/a.png", c).action === "abort");
    check("ultraLean keeps document", decideRequest("document", "http://x/", c).action === "allow");
    check("ultraLean opts out of downloads", c.acceptDownloads === false);
  }

  // 4. URL allow-list wins over a type block; URL block-list wins over a type allow.
  {
    const c: ResourceRoutingConfig = { ...profileDefaults("lean"), allowUrlPatterns: ["*/keep/*"], blockUrlPatterns: ["*/ads/*"] };
    check("allow-list URL overrides the image block", decideRequest("image", "http://x/keep/logo.png", c).action === "allow");
    check("block-list URL aborts an otherwise-allowed script", decideRequest("script", "http://x/ads/track.js", c).action === "abort");
  }

  // 5. Extra block/allow resource-type overrides.
  {
    const blockScript: ResourceRoutingConfig = { ...profileDefaults("normal"), blockResourceTypes: ["script"] };
    check("extra block applies even under normal", decideRequest("script", "http://x/a.js", blockScript).action === "abort");
    check("extra block makes normal routing-active", isRoutingActive(blockScript) === true);
    const allowImage: ResourceRoutingConfig = { ...profileDefaults("lean"), allowResourceTypes: ["image"] };
    check("allow override rescues image under lean", decideRequest("image", "http://x/a.png", allowImage).action === "allow");
  }

  // 6. Glob URL matching (`*`) and substring fallback are case-insensitive.
  {
    check("glob matches prefix", matchesUrlPattern("http://x/assets/a.png", "*/assets/*"));
    check("substring (no glob) matches", matchesUrlPattern("http://X/Analytics.js", "analytics"));
    check("non-match returns false", matchesUrlPattern("http://x/a.js", "*/never/*") === false);
  }

  // 7. Context options reflect the profile.
  {
    const normal = resolveContextOptions(profileDefaults("normal"));
    check("normal context options: accept downloads, no overrides", normal.acceptDownloads === true && normal.serviceWorkers === undefined && normal.reducedMotion === undefined && normal.deviceScaleFactor === undefined);
    const lean = resolveContextOptions(profileDefaults("lean"));
    check("lean context options block SW + reduce motion + scale 1", lean.serviceWorkers === "block" && lean.reducedMotion === "reduce" && lean.deviceScaleFactor === 1);
    const ultra = resolveContextOptions(profileDefaults("ultraLean"));
    check("ultraLean context options opt out of downloads", ultra.acceptDownloads === false);
  }

  // 8. Env parsing: profile aliases, extra lists, and download opt-in override.
  {
    const c = loadResourceRoutingConfig({
      AWKIT_RESOURCE_PROFILE: "ultra-lean",
      AWKIT_ALLOW_URL_PATTERNS: "*/keep/*, */brand/*",
      AWKIT_BLOCK_RESOURCE_TYPES: "script",
      AWKIT_ACCEPT_DOWNLOADS: "1",
      AWKIT_DEVICE_SCALE_FACTOR: "2"
    } as NodeJS.ProcessEnv);
    check("ultra-lean alias parses to ultraLean", c.profile === "ultraLean");
    check("allow patterns parsed + trimmed", c.allowUrlPatterns.length === 2 && c.allowUrlPatterns[1] === "*/brand/*");
    check("profile block set + extra block merged", c.blockResourceTypes.includes("stylesheet") && c.blockResourceTypes.includes("script"));
    check("download opt-in overrides ultraLean opt-out", c.acceptDownloads === true);
    check("device scale override parsed", c.deviceScaleFactor === 2);
    const def = loadResourceRoutingConfig({} as NodeJS.ProcessEnv);
    check("empty env → normal (no behavior change)", def.profile === "normal" && isRoutingActive(def) === false);
  }

  // 9. Artifact profiles map to trace/screenshot/video; default is today's behavior.
  {
    check("production → trace off", resolveArtifactSettings("production").traceMode === "off");
    check("balanced → trace onFailure (unchanged default)", resolveArtifactSettings("balanced").traceMode === "onFailure");
    check("debug → trace always", resolveArtifactSettings("debug").traceMode === "always");
    check("full → trace always + video", resolveArtifactSettings("full").traceMode === "always" && resolveArtifactSettings("full").video === true);
    check("all profiles keep failure screenshots", ["production", "balanced", "debug", "full"].every((p) => resolveArtifactSettings(p as any).screenshotOnFailure));
    check("unknown profile string → balanced", parseArtifactProfile("bogus") === "balanced");
    check("empty env → balanced", loadArtifactProfile({} as NodeJS.ProcessEnv) === "balanced");
    check("env selects debug", loadArtifactProfile({ AWKIT_ARTIFACT_PROFILE: "debug" } as NodeJS.ProcessEnv) === "debug");
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nResource routing + artifact profiles: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
