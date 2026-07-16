// Verifies the Browser Resource Optimization architecture (pure — no browser):
//   - src/runner/browserProfile/BrowserResourceProfile.ts   (named presets + routing mapping)
//   - src/runner/browserProfile/WorkflowCapabilities.ts     (static capability analysis)
//   - src/runner/browserProfile/BrowserRuntimeConfigurationResolver.ts (authoritative resolver)
//   - src/runner/browserProfile/resolveForRun.ts            (env entry point)
//   - src/runner/ChromiumHardening.ts                       (conditional background-throttle pin)
//
// The load-bearing invariant: BALANCED (default) resolves to today's exact behaviour. Capabilities only
// ever RELAX optimizations. Run: npx tsx scripts/verify-browser-resource-profile.mts
import {
  resolveBrowserResourceProfile,
  parseBrowserResourceProfileMode,
  resourceRoutingProfileFor
} from "../src/runner/browserProfile/BrowserResourceProfile";
import { analyzeWorkflowCapabilities, permissiveCapabilities } from "../src/runner/browserProfile/WorkflowCapabilities";
import {
  resolveBrowserRuntimeConfiguration,
  BACKGROUND_THROTTLING_DEFAULT_ARGS,
  explainResolution
} from "../src/runner/browserProfile/BrowserRuntimeConfigurationResolver";
import { resolveBrowserConfigurationForRun, loadBrowserResourceProfileMode } from "../src/runner/browserProfile/resolveForRun";
import { buildChromiumHardeningArgs } from "../src/runner/ChromiumHardening";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { FlowProfile, FlowStep } from "../src/profiles/FlowProfile";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const baseConfig = (over: Partial<InstanceConfig> = {}): InstanceConfig => ({
  id: "i1",
  name: "Instance 1",
  browser: "chromium",
  headless: true,
  isolationMode: "browserContext",
  timeoutMs: 30000,
  viewport: { width: 1365, height: 768 },
  ...over
});

const flowWith = (steps: Partial<FlowStep>[]): FlowProfile[] => [
  {
    id: "f1",
    name: "f1",
    nodes: steps.map((s, i) => ({ id: `n${i}`, type: "click", label: "n", ...s })) as FlowStep[],
    edges: []
  } as unknown as FlowProfile
];

function main() {
  // 1. BALANCED == today's behaviour (the load-bearing safety invariant).
  {
    const profile = resolveBrowserResourceProfile("balanced");
    const caps = permissiveCapabilities();
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("balanced → routing profile normal", r.resourceRouting.profile === "normal");
    check("balanced → no launch-arg additions", r.launchArgOverrides.add.length === 0);
    check("balanced → no ignoreDefaultArgs (throttling untouched)", r.launchArgOverrides.ignoreDefaultArgs.length === 0);
    check("balanced → keeps background-timer-throttle pin", r.launchArgOverrides.omitBackgroundTimerThrottlePin === false);
    check("balanced → service workers allow", r.resourceRouting.blockServiceWorkers === false);
    check("balanced → no reduced motion", r.resourceRouting.reducedMotion === false);
    check("balanced → accepts downloads", r.resourceRouting.acceptDownloads === true);
    check("balanced → device scale default (undefined)", r.resourceRouting.deviceScaleFactor === undefined);
    check("balanced → trace onFailure (today's default)", r.traceMode === "onFailure");
    check("balanced → page cleanup off", r.pageCleanup.enabled === false);
  }

  // 2. buildChromiumHardeningArgs: default pins the throttle switch; omit option drops it (and only it).
  {
    const def = buildChromiumHardeningArgs({} as NodeJS.ProcessEnv);
    const omitted = buildChromiumHardeningArgs({} as NodeJS.ProcessEnv, { omitBackgroundTimerThrottlePin: true });
    check("hardening default includes --disable-background-timer-throttling", def.includes("--disable-background-timer-throttling"));
    check("hardening omit drops --disable-background-timer-throttling", !omitted.includes("--disable-background-timer-throttling"));
    check(
      "hardening omit keeps every other switch (only one arg removed)",
      omitted.length === def.length - 1 && def.filter((a) => a !== "--disable-background-timer-throttling").every((a) => omitted.includes(a))
    );
  }

  // 3. LOW-RESOURCE with a bare workflow (no needs) applies the full aggressive posture.
  {
    const profile = resolveBrowserResourceProfile("low-resource");
    const caps = analyzeWorkflowCapabilities(baseConfig(), flowWith([{ type: "click" }]));
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("low-resource → routing profile lean", r.resourceRouting.profile === "lean");
    check("low-resource → blocks service workers", r.resourceRouting.blockServiceWorkers === true);
    check("low-resource → reduced motion", r.resourceRouting.reducedMotion === true);
    check("low-resource → device scale 1", r.resourceRouting.deviceScaleFactor === 1);
    // Background throttling is OFF in low-resource by measured evidence (occlusion experiment: zero benefit).
    check("low-resource → does NOT re-enable background throttling (no ignoreDefaultArgs)", r.launchArgOverrides.ignoreDefaultArgs.length === 0);
    check("low-resource → keeps throttle pin", r.launchArgOverrides.omitBackgroundTimerThrottlePin === false);
    check("low-resource → bounded disk cache arg", r.launchArgOverrides.add.some((a) => a.startsWith("--disk-cache-size=")));
    check("low-resource → blocks analytics URL patterns", r.resourceRouting.blockUrlPatterns.some((p) => p.includes("google-analytics")));
    check("low-resource → trace off (production artifacts)", r.traceMode === "off" && r.artifactProfile === "production");
    check("low-resource → page cleanup enabled", r.pageCleanup.enabled === true);
  }

  // 3b. The background-throttling MECHANISM still works for a Custom profile that opts in (kept for operators).
  {
    const profile = { ...resolveBrowserResourceProfile("custom"), backgroundThrottling: { enabled: true } };
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: permissiveCapabilities(), env: {} as NodeJS.ProcessEnv });
    check("custom+throttling → drops the 3 Playwright throttle defaults", BACKGROUND_THROTTLING_DEFAULT_ARGS.every((a) => r.launchArgOverrides.ignoreDefaultArgs.includes(a)));
    check("custom+throttling → omits throttle pin", r.launchArgOverrides.omitBackgroundTimerThrottlePin === true);
    const args = buildChromiumHardeningArgs({} as NodeJS.ProcessEnv, { omitBackgroundTimerThrottlePin: r.launchArgOverrides.omitBackgroundTimerThrottlePin });
    check("custom+throttling → hardening args exclude the throttle switch", !args.includes("--disable-background-timer-throttling"));
  }

  // 4. Capabilities RELAX low-resource: screenshots keep images + full resolution.
  {
    const profile = resolveBrowserResourceProfile("low-resource");
    const caps = analyzeWorkflowCapabilities(baseConfig(), flowWith([{ type: "screenshot", config: { fullPage: true } as any }]));
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("screenshot workflow → needsImages true", caps.needsImages === true);
    check("screenshot workflow → images re-allowed", r.resourceRouting.allowResourceTypes.includes("image"));
    check("full-page screenshot → device scale left default", r.resourceRouting.deviceScaleFactor === undefined);
  }

  // 5. Capabilities RELAX low-resource: downloads keep acceptDownloads; persistent profile keeps SW; popups disable cleanup.
  {
    const profile = resolveBrowserResourceProfile("low-resource");
    const caps = analyzeWorkflowCapabilities(
      baseConfig({ isolationMode: "persistentContext", userDataDir: "C:/tmp/p" }),
      flowWith([{ type: "downloadFile" }, { type: "switchToPopup" }])
    );
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("download workflow → needsDownloads true", caps.needsDownloads === true);
    check("download workflow → acceptDownloads stays true", r.resourceRouting.acceptDownloads === true);
    check("persistent profile → needsServiceWorkers true", caps.needsServiceWorkers === true);
    check("persistent profile → service workers left allowed", r.resourceRouting.blockServiceWorkers === false);
    check("popup workflow → needsMultiplePages true", caps.needsMultiplePages === true);
    check("popup workflow → page cleanup disabled", r.pageCleanup.enabled === false);
  }

  // 6. MAXIMUM-COMPATIBILITY never optimizes, regardless of capabilities.
  {
    const profile = resolveBrowserResourceProfile("maximum-compatibility");
    const caps = analyzeWorkflowCapabilities(baseConfig(), flowWith([{ type: "click" }]));
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("max-compat → routing normal", r.resourceRouting.profile === "normal");
    check("max-compat → no launch-arg deltas", r.launchArgOverrides.add.length === 0 && r.launchArgOverrides.ignoreDefaultArgs.length === 0);
    check("max-compat → service workers allow", r.resourceRouting.blockServiceWorkers === false);
  }

  // 7. Diagnostics carry source attribution; explain output is readable.
  {
    const profile = resolveBrowserResourceProfile("low-resource");
    const caps = analyzeWorkflowCapabilities(baseConfig(), flowWith([{ type: "screenshot" }]));
    const r = resolveBrowserRuntimeConfiguration({ profile, capabilities: caps, env: {} as NodeJS.ProcessEnv });
    check("diagnostics record backgroundThrottling source", r.diagnostics.some((d) => d.setting === "backgroundThrottling" && d.value === "disabled"));
    check("diagnostics record capability override source", r.diagnostics.some((d) => d.source.includes("WorkflowCapability:needsImages")));
    check("explainResolution starts with profile line", explainResolution(r)[0] === "profile=low-resource");
  }

  // 8. Mode parsing + env entry point.
  {
    check("parse 'low' → low-resource", parseBrowserResourceProfileMode("low") === "low-resource");
    check("parse 'max' → maximum-compatibility", parseBrowserResourceProfileMode("max") === "maximum-compatibility");
    check("parse bogus → balanced", parseBrowserResourceProfileMode("bogus") === "balanced");
    check("empty env → balanced mode", loadBrowserResourceProfileMode({} as NodeJS.ProcessEnv) === "balanced");
    const r = resolveBrowserConfigurationForRun(baseConfig(), flowWith([{ type: "click" }]), { env: { AWKIT_BROWSER_RESOURCE_PROFILE: "low-resource" } as NodeJS.ProcessEnv });
    check("resolveForRun honours env profile", r.profileMode === "low-resource");
    const rDefault = resolveBrowserConfigurationForRun(baseConfig(), flowWith([{ type: "click" }]), { env: {} as NodeJS.ProcessEnv });
    check("resolveForRun default → balanced (no optimization)", rDefault.profileMode === "balanced" && rDefault.resourceRouting.profile === "normal");
    const rNoFlows = resolveBrowserConfigurationForRun(baseConfig(), [], { env: { AWKIT_BROWSER_RESOURCE_PROFILE: "low-resource" } as NodeJS.ProcessEnv });
    check("resolveForRun w/o flows → permissive (images not blocked)", rNoFlows.resourceRouting.allowResourceTypes.includes("image"));
  }

  // 9. Routing-profile mapping is monotonic (blockStylesheet+image → ultraLean).
  {
    const p = resolveBrowserResourceProfile("custom");
    check("custom base → normal routing", resourceRoutingProfileFor(p) === "normal");
    const lean = { ...p, resources: { ...p.resources, blockImages: true } };
    check("blockImages → lean routing", resourceRoutingProfileFor(lean) === "lean");
    const ultra = { ...p, resources: { ...p.resources, blockImages: true, blockStylesheets: true } };
    check("blockImages+blockStylesheets → ultraLean routing", resourceRoutingProfileFor(ultra) === "ultraLean");
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nBrowser resource profile + resolver: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
