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

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-browser-pool crashed:", error);
  process.exit(1);
});
