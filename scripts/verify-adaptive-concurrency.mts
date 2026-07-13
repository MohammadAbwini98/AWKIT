// Verifies the adaptive concurrency controller (src/runner/concurrency/AdaptiveController.ts): it grows
// slowly toward the ceiling when healthy, shrinks under CPU/memory/event-loop/crash pressure (incl.
// load from other apps), holds under pressure, respects a cooldown, never leaves [1, ceiling], and a
// reconfigured ceiling takes effect immediately. Uses an injected clock. Pure — no Electron.
// Run: npx tsx scripts/verify-adaptive-concurrency.mts
import { AdaptiveController, type AdaptiveThresholds } from "../src/runner/concurrency/AdaptiveController";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

function thresholds(enabled = true): AdaptiveThresholds {
  return {
    enabled,
    growStep: 1,
    shrinkStep: 2,
    cooldownMs: 1000,
    healthyCpuPercent: 60,
    healthyMemoryPercent: 70,
    pressureCpuPercent: 85,
    pressureMemoryPercent: 85,
    pressureFreeMemoryMb: 512,
    pressureEventLoopMs: 200,
    criticalCpuPercent: 95,
    criticalMemoryPercent: 92,
    criticalEventLoopMs: 500,
    criticalCrashes: 3
  };
}
const HEALTHY = { cpuPercent: 30, systemMemoryPercent: 40, freeMemoryMb: 8000, recentCrashes: 0, queueDepth: 20 };
const CRITICAL = { cpuPercent: 97, systemMemoryPercent: 50, freeMemoryMb: 8000, recentCrashes: 0, queueDepth: 20 };
const PRESSURE = { cpuPercent: 88, systemMemoryPercent: 50, freeMemoryMb: 8000, recentCrashes: 0, queueDepth: 20 };

async function main() {
  // 1. Disabled → always the full ceiling regardless of pressure.
  {
    const c = new AdaptiveController(10, thresholds(false));
    c.evaluate({ ...CRITICAL, now: 5000 });
    check("disabled controller stays at the ceiling", c.currentTarget === 10 && c.currentState === "stable", `target=${c.currentTarget}`);
  }

  // 2. Healthy at ceiling holds at the ceiling (no behavior change when nothing to recover).
  {
    const c = new AdaptiveController(10, thresholds());
    for (let now = 1000; now <= 5000; now += 1000) c.evaluate({ ...HEALTHY, now });
    check("healthy at ceiling holds", c.currentTarget === 10 && c.currentState === "healthy", `target=${c.currentTarget}`);
  }

  // 3. Critical pressure shrinks the target (by shrinkStep per cooldown), never below 1.
  {
    const c = new AdaptiveController(10, thresholds());
    const seen: number[] = [];
    for (let now = 1000; now <= 12000; now += 1000) seen.push(c.evaluate({ ...CRITICAL, now }).target);
    check("critical pressure shrinks the target", c.currentState === "critical" && c.currentTarget < 10, `target=${c.currentTarget}`);
    check("target never drops below 1", Math.min(...seen) >= 1 && c.currentTarget === 1, `min=${Math.min(...seen)} final=${c.currentTarget}`);
  }

  // 4. After recovery the target grows back by growStep per cooldown, up to the ceiling.
  {
    const c = new AdaptiveController(10, thresholds());
    let now = 1000;
    for (; now <= 6000; now += 1000) c.evaluate({ ...CRITICAL, now }); // shrink to ~1
    const low = c.currentTarget;
    for (; now <= 30000; now += 1000) c.evaluate({ ...HEALTHY, now }); // recover
    check("target recovers upward after pressure clears", low < 10 && c.currentTarget === 10, `low=${low} recovered=${c.currentTarget}`);
    check("recovery stops at the ceiling (never above)", c.currentTarget === 10);
  }

  // 5. Pressure state holds the target (freeze — neither grows nor shrinks).
  {
    const c = new AdaptiveController(10, thresholds());
    for (let now = 1000; now <= 4000; now += 1000) c.evaluate({ ...CRITICAL, now }); // drop to 2
    const held = c.currentTarget;
    for (let now = 5000; now <= 9000; now += 1000) c.evaluate({ ...PRESSURE, now });
    check("pressure state holds the target (no grow, no shrink)", c.currentState === "pressure" && c.currentTarget === held, `state=${c.currentState} target=${c.currentTarget} held=${held}`);
  }

  // 6. Cooldown is respected: a second critical evaluation within the cooldown does not shrink again.
  {
    const c = new AdaptiveController(10, thresholds());
    c.evaluate({ ...CRITICAL, now: 1000 }); // 10 → 8
    const afterFirst = c.currentTarget;
    c.evaluate({ ...CRITICAL, now: 1500 }); // within cooldown → no change
    const withinCooldown = c.currentTarget;
    c.evaluate({ ...CRITICAL, now: 2000 }); // cooled → shrink again
    check("cooldown prevents back-to-back shrinks", afterFirst === 8 && withinCooldown === 8 && c.currentTarget === 6, `first=${afterFirst} within=${withinCooldown} after=${c.currentTarget}`);
  }

  // 7. Healthy with an empty queue does NOT grow (no pending work to use capacity).
  {
    const c = new AdaptiveController(10, thresholds());
    for (let now = 1000; now <= 4000; now += 1000) c.evaluate({ ...CRITICAL, now }); // 10 → 2
    const before = c.currentTarget;
    for (let now = 5000; now <= 12000; now += 1000) c.evaluate({ ...HEALTHY, queueDepth: 0, now });
    check("healthy but empty queue does not grow", c.currentTarget === before, `before=${before} after=${c.currentTarget}`);
  }

  // 8. Event-loop delay and crash spikes independently trigger critical.
  {
    const c = new AdaptiveController(10, thresholds());
    const lag = c.evaluate({ cpuPercent: 20, systemMemoryPercent: 20, freeMemoryMb: 8000, eventLoopDelayMs: 600, recentCrashes: 0, queueDepth: 5, now: 1000 });
    const crashes = new AdaptiveController(10, thresholds()).evaluate({ cpuPercent: 20, systemMemoryPercent: 20, freeMemoryMb: 8000, recentCrashes: 5, queueDepth: 5, now: 1000 });
    check("high event-loop delay is critical", lag.state === "critical");
    check("crash spike is critical", crashes.state === "critical");
  }

  // 9. setCeiling jumps the target to the new ceiling immediately (operator reconfiguration).
  {
    const c = new AdaptiveController(10, thresholds());
    for (let now = 1000; now <= 5000; now += 1000) c.evaluate({ ...CRITICAL, now }); // shrink low
    c.setCeiling(6);
    check("setCeiling jumps target to the new (higher) ceiling", c.currentTarget === 6, `target=${c.currentTarget}`);
    c.setCeiling(3);
    check("setCeiling clamps target to a lower ceiling", c.currentTarget === 3, `target=${c.currentTarget}`);
  }

  // 10. Unknown/undefined samples don't crash and are treated conservatively (no growth).
  {
    const c = new AdaptiveController(10, thresholds());
    for (let now = 1000; now <= 4000; now += 1000) c.evaluate({ ...CRITICAL, now }); // drop to 2
    const before = c.currentTarget;
    const r = c.evaluate({ recentCrashes: 0, queueDepth: 5, now: 6000 }); // no cpu/mem known
    check("missing samples do not force growth (stable, held)", c.currentTarget === before && (r.state === "healthy" || r.state === "stable"), `state=${r.state} target=${c.currentTarget}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nAdaptive concurrency: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
