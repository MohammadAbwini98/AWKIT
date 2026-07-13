// Verifies the operation limiters (src/runner/concurrency/OperationLimiters.ts): each expensive
// operation kind never exceeds its configured concurrency under a burst, kinds are independent,
// permits are released even when the operation throws, and reconfiguring changes the cap (including
// Sequential → all 1). Pure — no Electron/Chromium. Run: npx tsx scripts/verify-operation-limiters.mts
import { OperationLimiters, type OperationKind } from "../src/runner/concurrency/OperationLimiters";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fire `count` operations of `kind` and return the peak observed concurrency. */
async function burst(limiters: OperationLimiters, kind: OperationKind, count: number, holdMs = 15): Promise<number> {
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: count }, () =>
      limiters.run(kind, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(holdMs);
        active -= 1;
      })
    )
  );
  return peak;
}

async function main() {
  const cfg = { browserLaunch: 2, contextCreation: 4, navigation: 3, download: 3, screenshot: 2 };

  // 1. Each kind never exceeds its configured concurrency under a 12-op burst.
  {
    const limiters = new OperationLimiters(cfg);
    const nav = await burst(limiters, "navigation", 12);
    const launch = await burst(limiters, "browserLaunch", 12);
    const shot = await burst(limiters, "screenshot", 12);
    check("navigation peak <= 3", nav <= 3, `peak=${nav}`);
    check("browserLaunch peak <= 2", launch <= 2, `peak=${launch}`);
    check("screenshot peak <= 2", shot <= 2, `peak=${shot}`);
  }

  // 2. Every op still runs (throughput): 12 navigations all complete.
  {
    const limiters = new OperationLimiters(cfg);
    let done = 0;
    await Promise.all(Array.from({ length: 12 }, () => limiters.run("navigation", async () => { done += 1; })));
    check("all bursted operations complete (no starvation)", done === 12, `done=${done}`);
  }

  // 3. Kinds are independent: a saturated navigation limiter does not block downloads.
  {
    const limiters = new OperationLimiters({ ...cfg, navigation: 1, download: 3 });
    let downloadRan = false;
    const held = limiters.run("navigation", async () => sleep(60)); // hold the only navigation permit
    await limiters.run("download", async () => { downloadRan = true; }); // must not block on navigation
    await held;
    check("a saturated kind does not block a different kind", downloadRan === true);
  }

  // 4. A permit is released even when the operation throws (finally), so the limiter isn't leaked.
  {
    const limiters = new OperationLimiters({ ...cfg, navigation: 1 });
    await limiters.run("navigation", async () => { throw new Error("boom"); }).catch(() => undefined);
    let recovered = false;
    await limiters.run("navigation", async () => { recovered = true; });
    check("permit released after a throwing operation", recovered === true);
  }

  // 5. Reconfiguring raises the cap for subsequent operations.
  {
    const limiters = new OperationLimiters({ ...cfg, navigation: 2 });
    const before = await burst(limiters, "navigation", 10);
    limiters.configure({ navigation: 6 });
    const after = await burst(limiters, "navigation", 10);
    check("configure raises the concurrency cap", before <= 2 && after > 2 && after <= 6, `before=${before} after=${after}`);
  }

  // 6. Sequential (all 1) fully serializes every kind (peak == 1).
  {
    const limiters = new OperationLimiters({ browserLaunch: 1, contextCreation: 1, navigation: 1, download: 1, screenshot: 1 });
    const nav = await burst(limiters, "navigation", 8);
    const ctx = await burst(limiters, "contextCreation", 8);
    check("sequential config serializes navigation (peak == 1)", nav === 1, `peak=${nav}`);
    check("sequential config serializes context creation (peak == 1)", ctx === 1, `peak=${ctx}`);
  }

  // 7. snapshot reflects the live caps.
  {
    const limiters = new OperationLimiters(cfg);
    limiters.configure({ download: 5 });
    const snap = limiters.snapshot();
    check("snapshot reflects configured caps", snap.download === 5 && snap.navigation === 3);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nOperation limiters: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
