/**
 * Browser pool verification (deterministic, fake runtimes — no real browsers).
 * Run with: npx tsx scripts/verify-browser-pool.mts
 *
 * Proves: slot caps + saturation refusal, slot release after failure/cancel-style teardown,
 * runtime registration (context/page/crash/disconnect tracking with generation guards),
 * page-budget checks, crash-window counting, and snapshot accuracy.
 */
import { EventEmitter } from "node:events";
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";
import { BackpressureController } from "@src/runner/concurrency/BackpressureController";
import { closeIsolatedRuntime } from "@src/runner/BrowserContextFactory";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal fake Playwright context/browser/page for pool event wiring. */
class FakePage extends EventEmitter {}
class FakeContext extends EventEmitter {
  private readonly openPages: FakePage[] = [];
  pages(): FakePage[] {
    return [...this.openPages];
  }
  openPage(): FakePage {
    const page = new FakePage();
    this.openPages.push(page);
    this.emit("page", page);
    page.on("close", () => {
      const index = this.openPages.indexOf(page);
      if (index >= 0) this.openPages.splice(index, 1);
    });
    return page;
  }
}
class FakeBrowser extends EventEmitter {}

async function main(): Promise<void> {
  console.log("Browser pool verification");

  console.log("\nPart A — slot caps and saturation");
  const pool = new BrowserWorkerPool({ maxBrowsersPerHost: 2, maxPagesPerContext: 2, crashWindowMs: 60_000, minFreeMemoryMb: 0 });
  const s1 = pool.tryAcquireSlot("i1");
  const s2 = pool.tryAcquireSlot("i2");
  check("grants up to the cap", s1 !== null && s2 !== null);
  check("refuses work when saturated (queues, does not crash)", pool.tryAcquireSlot("i3") === null);
  const snapshot1 = pool.snapshot();
  check("snapshot: activeSlots/maxSlots/rejected", snapshot1.activeSlots === 2 && snapshot1.maxSlots === 2 && snapshot1.totalRejected === 1);

  console.log("\nPart B — runtime registration + page/crash tracking");
  const context = new FakeContext();
  const browser = new FakeBrowser();
  pool.registerRuntime(s1!, { browser: browser as never, context: context as never }, 1);
  check("registration counts the context", s1!.activeContexts === 1);

  const pageA = context.openPage();
  const pageB = context.openPage();
  check("page opens tracked", s1!.activePages === 2);
  check("page budget: at cap, cannot open another", !pool.canOpenPage(s1!));
  pageA.emit("close");
  check("page close tracked; budget frees", s1!.activePages === 1 && pool.canOpenPage(s1!));

  pageB.emit("crash");
  check("page crash marks slot unhealthy + counts in crash window", s1!.unhealthy && pool.recentCrashCount() === 1);

  // Generation guard: events from an old generation are ignored after a swap.
  const context2 = new FakeContext();
  pool.registerRuntime(s2!, { browser: undefined, context: context2 as never }, 1);
  const oldContextPages = context2.openPage();
  pool.registerRuntime(s2!, { browser: undefined, context: new FakeContext() as never }, 2);
  const pagesBefore = s2!.activePages;
  oldContextPages.emit("close"); // old generation event
  check("old-generation page events ignored after swap", s2!.activePages === pagesBefore);

  console.log("\nPart C — release paths (failure / cancel teardown)");
  pool.releaseSlot(s1!); // "failure" teardown: unhealthy slot still releases capacity
  check("slot released after failure (unhealthy slot frees capacity)", pool.tryAcquireSlot("i4") !== null);
  pool.releaseSlot(s2!); // "cancel" teardown
  pool.releaseSlot(s2!); // double release must be safe
  const s5 = pool.tryAcquireSlot("i5");
  check("slot released after cancellation (double-release safe)", s5 !== null);

  console.log("\nPart D — backpressure integration");
  const bp = new BackpressureController(pool);
  const blocked = bp.admit(99, 0);
  check("backpressure blocks when active flows exceed the cap", !blocked.allow);
  const snap = bp.snapshot(1, 2);
  check("capacity snapshot carries pool counts + queue depth", snap.activeBrowsers === pool.snapshot().activeSlots && snap.queueDepth === 2);

  // Regression: the runner closes its own browser at end-of-run; that intentional "disconnected"
  // must not be scored as a crash (it used to, so ordinary run completions inflated the crash
  // window and tripped "browser crash rate high — pausing new dispatch", stranding the queue).
  console.log("\nPart E — intentional teardown is not a crash (backpressure false-positive)");
  const teardownPool = new BrowserWorkerPool({ maxBrowsersPerHost: 4, crashWindowMs: 60_000, minFreeMemoryMb: 0 });

  const t1 = teardownPool.tryAcquireSlot("t1")!;
  const crashBrowser = new FakeBrowser();
  teardownPool.registerRuntime(t1, { browser: crashBrowser as never, context: new FakeContext() as never }, 1);
  crashBrowser.emit("disconnected"); // no expected-close signal → genuine crash
  check("unexpected browser disconnect still counts as a crash", teardownPool.recentCrashCount() === 1 && t1.unhealthy);

  const t2 = teardownPool.tryAcquireSlot("t2")!;
  const okBrowser = new FakeBrowser();
  teardownPool.registerRuntime(t2, { browser: okBrowser as never, context: new FakeContext() as never }, 1);
  teardownPool.markExpectedClose(t2, 1); // runner announces intentional end-of-run close
  okBrowser.emit("disconnected");
  check("intentional teardown close is NOT counted as a crash", teardownPool.recentCrashCount() === 1 && !t2.unhealthy);

  const t3 = teardownPool.tryAcquireSlot("t3")!;
  teardownPool.registerRuntime(t3, { browser: new FakeBrowser() as never, context: new FakeContext() as never }, 1);
  teardownPool.markExpectedClose(t3, 1); // old generation's swap-close is expected…
  const gen2Browser = new FakeBrowser();
  teardownPool.registerRuntime(t3, { browser: gen2Browser as never, context: new FakeContext() as never }, 2);
  gen2Browser.emit("disconnected"); // …but a real crash of the newer generation still counts
  check("expected-close is generation-scoped (later-generation crash still counts)", teardownPool.recentCrashCount() === 2);

  // Regression (audit A4): the isolated-context teardown must always close the browser, even when
  // context.close() rejects — otherwise a throwing context close orphans the Chromium process.
  console.log("\nPart F — isolated teardown always closes the browser (A4)");
  {
    let browserClosed = false;
    const throwingContext = { close: async () => { throw new Error("context already crashed"); } };
    const okBrowser = { close: async () => { browserClosed = true; } };
    let propagated = false;
    await closeIsolatedRuntime(throwingContext, okBrowser).catch(() => { propagated = true; });
    check("browser is closed even when context.close() rejects", browserClosed);
    check("the context close error still propagates (not swallowed)", propagated);
  }
  {
    // Happy path: both close, no throw.
    let ctxClosed = false;
    let brwClosed = false;
    let threw = false;
    await closeIsolatedRuntime(
      { close: async () => { ctxClosed = true; } },
      { close: async () => { brwClosed = true; } }
    ).catch(() => { threw = true; });
    check("normal teardown closes context then browser without error", ctxClosed && brwClosed && !threw);
  }
  {
    // A failing browser.close must not mask the (successful) context close — it is swallowed.
    let threw = false;
    await closeIsolatedRuntime(
      { close: async () => undefined },
      { close: async () => { throw new Error("browser close failed"); } }
    ).catch(() => { threw = true; });
    check("a failing browser.close is swallowed when context closed cleanly", !threw);
  }

  // Settings-driven caps (Settings UI → engine.configureConcurrency → pool.reconfigure).
  console.log("\nPart G — reconfigure applies Settings caps (live flows; guarded browser resize)");
  {
    const rp = new BrowserWorkerPool({ maxBrowsersPerHost: 2, maxActiveFlows: 4, crashWindowMs: 60_000, minFreeMemoryMb: 0 });
    rp.reconfigure({ maxActiveFlows: 9 });
    check("maxActiveFlows updates live", rp.concurrencyLimits.maxActiveFlows === 9);

    rp.reconfigure({ maxBrowsersPerHost: 5 }); // idle → resize allowed
    check("idle reconfigure raises the browser slot cap", rp.snapshot().maxSlots === 5, `maxSlots=${rp.snapshot().maxSlots}`);
    const held = [1, 2, 3, 4, 5].map((n) => rp.tryAcquireSlot(`g${n}`));
    check("all 5 slots are grantable after raising the cap", held.every((s) => s !== null) && rp.tryAcquireSlot("g6") === null);

    rp.reconfigure({ maxBrowsersPerHost: 8 }); // busy → deferred, stays in sync with the live semaphore
    check("busy reconfigure does NOT resize (cap stays in sync)", rp.snapshot().maxSlots === 5 && rp.concurrencyLimits.maxBrowsersPerHost === 5);

    held.forEach((s) => s && rp.releaseSlot(s));
    rp.reconfigure({ maxBrowsersPerHost: 8 }); // idle again → applies
    check("reconfigure applies once the pool is idle again", rp.snapshot().maxSlots === 8, `maxSlots=${rp.snapshot().maxSlots}`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-browser-pool crashed:", error);
  process.exit(1);
});
