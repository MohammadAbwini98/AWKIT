// Unit checks for the shared Chromium pool (src/runner/browser/SharedBrowserPool.ts) and shared-
// eligibility classification (browserSharing.ts), using fake Browser/BrowserContext objects so the
// pool logic is proven without launching real Chromium. Covers packing/spread, least-loaded reuse,
// per-browser hard limit, crash health, recycle-after-N + drain, and dedicated-vs-shared routing.
//
// Pure — no Electron/Chromium. Run: npx tsx scripts/verify-shared-browser-pool.mts
import { SharedBrowserPool, SharedBrowserPoolExhaustedError, type SharedBrowserLauncher } from "../src/runner/browser/SharedBrowserPool";
import { isSharedEligible, scenarioUsesBrowserSwap, sharedLaunchKey } from "../src/runner/browser/browserSharing";
import type { FlowProfile } from "../src/profiles/FlowProfile";
import type { InstanceConfig } from "../src/instances/InstanceConfig";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

// ── Fakes ────────────────────────────────────────────────────────────────────
function makeState() {
  return { browserSeq: 0, launched: 0, closedBrowsers: 0, createdContexts: 0, closedContexts: 0 };
}
function makeFakeBrowser(state: ReturnType<typeof makeState>) {
  const handlers: Record<string, Array<() => void>> = {};
  const browser: any = {
    _id: ++state.browserSeq,
    closed: false,
    on(evt: string, fn: () => void) {
      (handlers[evt] ||= []).push(fn);
      return browser;
    },
    async close() {
      if (browser.closed) return;
      browser.closed = true;
      state.closedBrowsers += 1;
      (handlers.disconnected || []).forEach((fn) => fn());
    },
    _crash() {
      (handlers.disconnected || []).forEach((fn) => fn());
    }
  };
  return browser;
}
function makeLauncher(state: ReturnType<typeof makeState>, launchKey = "chromium:headless"): SharedBrowserLauncher {
  return {
    launchKey,
    async launch() {
      state.launched += 1;
      return makeFakeBrowser(state);
    },
    async newContext() {
      state.createdContexts += 1;
      return { closed: false, async close() { if (!this.closed) { this.closed = true; state.closedContexts += 1; } } } as any;
    }
  };
}

async function main() {
  // 1. Spread across browsers up to maxBrowsers, then pack — 16 contexts on 4 browsers × 4 each.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 4, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    for (let i = 0; i < 16; i++) await pool.acquireContext(launcher);
    const snap = pool.snapshot();
    const perBrowser = snap.browsers.map((b) => b.activeContexts).sort();
    check("16 contexts pack onto exactly 4 shared browsers", snap.totalBrowsers === 4 && state.launched === 4, `browsers=${snap.totalBrowsers} launched=${state.launched}`);
    check("contexts spread evenly (4 per browser)", perBrowser.every((n) => n === 4) && snap.activeContexts === 16, `perBrowser=${perBrowser}`);
  }

  // 2. Least-loaded reuse: after releasing a browser's only context, the next acquire reuses it.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    const a = await pool.acquireContext(launcher); // B1
    await pool.acquireContext(launcher); // B2 (spread)
    await a.release(); // B1 → 0 contexts
    const c = await pool.acquireContext(launcher); // least-loaded = B1
    check("least-loaded browser is reused (no new launch)", c.browserId === a.browserId && state.launched === 2, `reused=${c.browserId === a.browserId} launched=${state.launched}`);
  }

  // 3. Per-browser hard limit caps contexts and then reports exhaustion at maxBrowsers.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 1, maxContextsPerBrowser: 100, maxContextsPerBrowserHardLimit: 3, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    for (let i = 0; i < 3; i++) await pool.acquireContext(launcher);
    let threw = false;
    try {
      await pool.acquireContext(launcher);
    } catch (e) {
      threw = e instanceof SharedBrowserPoolExhaustedError;
    }
    check("hard limit caps contexts per browser (3) then throws exhausted", threw && pool.snapshot().activeContexts === 3, `active=${pool.snapshot().activeContexts} threw=${threw}`);
  }

  // 4. A crashed shared browser is not reused; the next acquire launches a fresh one.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    const a = await pool.acquireContext(launcher);
    (a.browser as any)._crash();
    const b = await pool.acquireContext(launcher);
    check("crashed browser is dropped and replaced", b.browserId !== a.browserId && state.launched === 2 && pool.snapshot().totalBrowsers === 1, `launched=${state.launched} browsers=${pool.snapshot().totalBrowsers}`);
  }

  // 5. Recycle after N contexts: browser stops taking work and closes once drained; a replacement launches.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 1, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 2 });
    const launcher = makeLauncher(state);
    const c1 = await pool.acquireContext(launcher); // B1 created#1
    const c2 = await pool.acquireContext(launcher); // B1 created#2 → recycling
    const c3 = await pool.acquireContext(launcher); // B1 recycling → launch B2
    check("recycling browser is replaced by a fresh one", c3.browserId !== c1.browserId && state.launched === 2, `launched=${state.launched}`);
    await c1.release();
    await c2.release(); // B1 drained (0 contexts + recycling) → closed
    check("recycled browser closes once drained", state.closedBrowsers === 1 && !pool.snapshot().browsers.some((b) => b.id === c1.browserId), `closed=${state.closedBrowsers}`);
    await c3.release();
  }

  // 6. drainIdle closes idle browsers, keeps busy ones.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    const a = await pool.acquireContext(launcher); // B1
    await pool.acquireContext(launcher); // B2 (busy)
    await a.release(); // B1 idle
    await pool.drainIdle();
    check("drainIdle closes idle browsers but keeps busy ones", pool.snapshot().totalBrowsers === 1 && state.closedBrowsers === 1, `browsers=${pool.snapshot().totalBrowsers} closed=${state.closedBrowsers}`);
  }

  // 7. release closes the context; closeAll closes everything.
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    const launcher = makeLauncher(state);
    const a = await pool.acquireContext(launcher);
    await a.release();
    check("release closes the leased context", state.closedContexts === 1);
    await pool.acquireContext(launcher);
    await pool.acquireContext(launcher);
    await pool.closeAll();
    check("closeAll closes every shared browser", pool.snapshot().totalBrowsers === 0);
  }

  // 8. Headed and headless instances never share a browser process (different launch keys).
  {
    const state = makeState();
    const pool = new SharedBrowserPool({ maxBrowsers: 4, maxContextsPerBrowser: 4, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
    await pool.acquireContext(makeLauncher(state, "chromium:headless"));
    await pool.acquireContext(makeLauncher(state, "chromium:headed"));
    const keys = new Set(pool.snapshot().browsers.map((b) => b.launchKey));
    check("different launch keys use separate browsers", pool.snapshot().totalBrowsers === 2 && keys.size === 2, `keys=${[...keys]}`);
  }

  // 9. Classification: eligibility + swap detection + launch key.
  {
    const base: InstanceConfig = { id: "i", name: "i", browser: "chromium", headless: true, isolationMode: "browserContext", timeoutMs: 30000, viewport: { width: 1280, height: 720 } };
    const plainFlow = { id: "f", nodes: [{ id: "n1", type: "click" }] } as unknown as FlowProfile;
    const swapFlow = { id: "f2", nodes: [{ id: "n2", type: "reuseSession" }] } as unknown as FlowProfile;
    check("eligible: browserContext + no swap + flag on", isSharedEligible(base, [plainFlow], true) === true);
    check("not eligible when flag off", isSharedEligible(base, [plainFlow], false) === false);
    check("not eligible for persistentContext", isSharedEligible({ ...base, isolationMode: "persistentContext" }, [plainFlow], true) === false);
    check("not eligible when a flow swaps the browser (reuseSession)", isSharedEligible(base, [swapFlow], true) === false);
    check("not eligible with a captured session profile", isSharedEligible({ ...base, sessionProfileId: "s1" }, [plainFlow], true) === false);
    check("scenarioUsesBrowserSwap detects swap nodes", scenarioUsesBrowserSwap([plainFlow]) === false && scenarioUsesBrowserSwap([swapFlow]) === true);
    check("launch key separates headed/headless", sharedLaunchKey(base) !== sharedLaunchKey({ ...base, headless: false }));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nShared browser pool: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
