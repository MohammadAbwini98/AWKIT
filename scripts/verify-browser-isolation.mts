// Unit checks for the authoritative browser-isolation resolver + launch-arg-aware compatibility key
// (src/runner/browser/BrowserIsolationResolver.ts). Proves the four-class classification, precedence,
// shareability, back-compat with isSharedEligible, and — the correctness fix — that the compatibility key
// gates sharing on the browser-LEVEL launch config (not context-level differences). It also drives the
// real SharedBrowserPool with divergent keys to prove incompatible launch configs never share a process.
//
// Pure — no Electron/Chromium. Run: npx tsx scripts/verify-browser-isolation.mts
import {
  resolveBrowserIsolation,
  sharedCompatibilityKey,
  scenarioUsesBrowserSwap,
  type BrowserIsolationClass
} from "../src/runner/browser/BrowserIsolationResolver";
import { isSharedEligible } from "../src/runner/browser/browserSharing";
import { SharedBrowserPool, type SharedBrowserLauncher } from "../src/runner/browser/SharedBrowserPool";
import type { LaunchArgOverrides } from "../src/runner/browserProfile/BrowserRuntimeConfigurationResolver";
import type { FlowProfile } from "../src/profiles/FlowProfile";
import type { InstanceConfig } from "../src/instances/InstanceConfig";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const base: InstanceConfig = {
  id: "i",
  name: "i",
  browser: "chromium",
  headless: true,
  isolationMode: "browserContext",
  timeoutMs: 30000,
  viewport: { width: 1280, height: 720 }
};
const plainFlow = { id: "f", nodes: [{ id: "n1", type: "click" }] } as unknown as FlowProfile;
const swapFlow = { id: "f2", nodes: [{ id: "n2", type: "reuseSession" }] } as unknown as FlowProfile;

const balanced: LaunchArgOverrides = { add: [], ignoreDefaultArgs: [], omitBackgroundTimerThrottlePin: false };
const lowResource: LaunchArgOverrides = { add: ["--disable-gpu", "--disk-cache-size=67108864"], ignoreDefaultArgs: [], omitBackgroundTimerThrottlePin: false };
const throttling: LaunchArgOverrides = { add: [], ignoreDefaultArgs: ["--disable-renderer-backgrounding"], omitBackgroundTimerThrottlePin: true };

function cls(config: InstanceConfig, flows: FlowProfile[], flag: boolean, overrides?: LaunchArgOverrides): BrowserIsolationClass {
  return resolveBrowserIsolation(config, flows, { sharedPoolEnabled: flag, launchArgOverrides: overrides }).isolationClass;
}

function makeLauncher(state: { launched: number }, launchKey: string): SharedBrowserLauncher {
  return {
    launchKey,
    async launch() {
      state.launched += 1;
      const handlers: Record<string, Array<() => void>> = {};
      return {
        on(evt: string, fn: () => void) { (handlers[evt] ||= []).push(fn); return this; },
        async close() { (handlers.disconnected || []).forEach((fn) => fn()); }
      } as any;
    },
    async newContext() {
      return { async close() { /* noop */ } } as any;
    }
  };
}

async function main() {
  // ── 1. Four-class classification ────────────────────────────────────────────
  check("normal workflow + flag on → SHARED_CONTEXT", cls(base, [plainFlow], true) === "SHARED_CONTEXT");
  check("normal workflow + flag off → DEDICATED_BROWSER", cls(base, [plainFlow], false) === "DEDICATED_BROWSER");
  check("persistentContext isolation → PERSISTENT_BROWSER", cls({ ...base, isolationMode: "persistentContext" }, [plainFlow], true) === "PERSISTENT_BROWSER");
  check("explicit userDataDir → PERSISTENT_BROWSER", cls({ ...base, userDataDir: "C:/tmp/p" }, [plainFlow], true) === "PERSISTENT_BROWSER");
  check("captured session profile → PERSISTENT_BROWSER", cls({ ...base, sessionProfileId: "s1" }, [plainFlow], true) === "PERSISTENT_BROWSER");
  check("browser-swap node (reuseSession) → HANDOFF_BROWSER", cls(base, [swapFlow], true) === "HANDOFF_BROWSER");

  // ── 2. Precedence — persistent profile is the strongest constraint, even over a swap node ───
  check("persistent + swap → PERSISTENT_BROWSER (persistent wins)", cls({ ...base, sessionProfileId: "s1" }, [swapFlow], true) === "PERSISTENT_BROWSER");
  check("swap node dedicates even with flag off (HANDOFF over generic dedicated)", cls(base, [swapFlow], false) === "HANDOFF_BROWSER");

  // ── 3. Shareability — only SHARED_CONTEXT is shareable ──────────────────────
  check("SHARED_CONTEXT is shareable", resolveBrowserIsolation(base, [plainFlow], { sharedPoolEnabled: true }).shareable === true);
  check("DEDICATED_BROWSER is not shareable", resolveBrowserIsolation(base, [plainFlow], { sharedPoolEnabled: false }).shareable === false);
  check("PERSISTENT_BROWSER is not shareable", resolveBrowserIsolation({ ...base, sessionProfileId: "s1" }, [plainFlow], { sharedPoolEnabled: true }).shareable === false);
  check("HANDOFF_BROWSER is not shareable", resolveBrowserIsolation(base, [swapFlow], { sharedPoolEnabled: true }).shareable === false);

  // ── 4. Back-compat: isSharedEligible == resolver.shareable ──────────────────
  check("isSharedEligible matches resolver (eligible)", isSharedEligible(base, [plainFlow], true) === true);
  check("isSharedEligible matches resolver (flag off)", isSharedEligible(base, [plainFlow], false) === false);
  check("isSharedEligible matches resolver (swap)", isSharedEligible(base, [swapFlow], true) === false);
  check("scenarioUsesBrowserSwap detects swap nodes", scenarioUsesBrowserSwap([plainFlow]) === false && scenarioUsesBrowserSwap([swapFlow]) === true);

  // ── 5. Compatibility key — the correctness fix ──────────────────────────────
  check("headed and headless get different keys", sharedCompatibilityKey({ ...base, headless: true }) !== sharedCompatibilityKey({ ...base, headless: false }));
  check("same config + same overrides → same key (still shares)", sharedCompatibilityKey(base, balanced) === sharedCompatibilityKey(base, balanced));
  check("balanced (empty) overrides == no overrides key", sharedCompatibilityKey(base) === sharedCompatibilityKey(base, balanced));
  check("different launch args → different keys (must NOT share)", sharedCompatibilityKey(base, balanced) !== sharedCompatibilityKey(base, lowResource));
  check("ignoreDefaultArgs / throttle-pin change the key", sharedCompatibilityKey(base, balanced) !== sharedCompatibilityKey(base, throttling));
  check("launch-arg order does not change the key (sorted)", sharedCompatibilityKey(base, { ...lowResource, add: ["--disk-cache-size=67108864", "--disable-gpu"] }) === sharedCompatibilityKey(base, lowResource));
  // Context-LEVEL differences must NOT change the browser-level key (they are isolated per context).
  check("viewport differences do NOT change the key", sharedCompatibilityKey(base, balanced) === sharedCompatibilityKey({ ...base, viewport: { width: 800, height: 600 } }, balanced));
  check("storageState differences do NOT change the key", sharedCompatibilityKey(base, balanced) === sharedCompatibilityKey({ ...base, storageState: "state.json" }, balanced));

  // ── 6. Diagnostics explain the decision ─────────────────────────────────────
  const shared = resolveBrowserIsolation(base, [plainFlow], { sharedPoolEnabled: true, launchArgOverrides: lowResource });
  check("SHARED_CONTEXT diagnostics carry class + compatibilityKey + sources", shared.diagnostics.some((d) => d.decision === "isolation" && d.value === "SHARED_CONTEXT" && !!d.source) && shared.diagnostics.some((d) => d.decision === "compatibilityKey"));
  const handoff = resolveBrowserIsolation(base, [swapFlow], { sharedPoolEnabled: true });
  check("HANDOFF_BROWSER diagnostic names the swap source", handoff.diagnostics.some((d) => d.value === "HANDOFF_BROWSER" && /swap/.test(d.source)));

  // ── 7. The pool honours the key — incompatible launch configs never share ───
  {
    const state = { launched: 0 };
    // maxBrowsers: 1 per launch key forces packing, so same-key contexts must share their one browser
    // while a divergent launch config is forced onto its own — proving the key gates process sharing.
    const pool = new SharedBrowserPool({ maxBrowsers: 1, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const keyBalanced = sharedCompatibilityKey(base, balanced);
    const keyLow = sharedCompatibilityKey(base, lowResource);
    await pool.acquireContext(makeLauncher(state, keyBalanced));
    await pool.acquireContext(makeLauncher(state, keyBalanced)); // same key → packs onto the same browser
    await pool.acquireContext(makeLauncher(state, keyLow)); // different launch args → its own browser
    const snap = pool.snapshot();
    const keys = new Set(snap.browsers.map((b) => b.launchKey));
    const balancedBrowser = snap.browsers.find((b) => b.launchKey === keyBalanced);
    check(
      "two balanced contexts share one browser; low-resource gets its own",
      snap.totalBrowsers === 2 && keys.size === 2 && balancedBrowser?.activeContexts === 2,
      `browsers=${snap.totalBrowsers} keys=${keys.size} balancedContexts=${balancedBrowser?.activeContexts}`
    );
    await pool.closeAll();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nBrowser isolation resolver: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
