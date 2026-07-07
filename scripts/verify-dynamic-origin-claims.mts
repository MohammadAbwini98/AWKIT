/**
 * Dynamic origin-claim verification. Pure tracker checks plus a LIVE StepExecutor part using a
 * tiny local HTTP server reachable as two different hostnames (127.0.0.1 vs localhost) — a real
 * cross-origin navigation with no external websites.
 * Run with: npx tsx scripts/verify-dynamic-origin-claims.mts
 */
import { createServer } from "node:http";
import { chromium } from "playwright";
import { OriginClaimTracker, OriginClaimTimeoutError } from "@src/runner/concurrency/OriginClaimTracker";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function main(): Promise<void> {
  console.log("Dynamic origin-claim verification");

  console.log("\nPart A — tracker semantics (origin:* capacity 1)");
  const locks = new ResourceLockManager({ "origin:*": 1 });
  const logs: string[] = [];
  const trackerA = new OriginClaimTracker("inst-A", locks, { enabled: true, timeoutMs: 400, log: (m) => logs.push(m) });

  const seedToken = locks.tryAcquire("inst-A", { key: "origin:a.test", mode: "semaphore" });
  trackerA.seed("a.test", seedToken!);
  check("seeded with dispatch-time origin", trackerA.origin === "a.test");

  await trackerA.ensureOrigin("a.test");
  check("same-origin navigation is a no-op (no lock churn)", locks.holdersOf("origin:a.test").length === 1 && trackerA.transitions.length === 0);

  await trackerA.ensureOrigin("b.test");
  check("cross-origin acquires origin:b.test", locks.isHeld("origin:b.test") && trackerA.origin === "b.test");
  check("old origin:a.test released after the move", !locks.isHeld("origin:a.test"));
  check("transition logged with from/to", trackerA.transitions.length === 1 && trackerA.transitions[0].from === "a.test" && trackerA.transitions[0].to === "b.test" && logs.some((l) => l.includes("a.test → b.test")));

  // Saturation: capacity 1 on b.test is now held by inst-A; inst-B must time out — only for b.test.
  const trackerB = new OriginClaimTracker("inst-B", locks, { enabled: true, timeoutMs: 300, log: () => undefined });
  let timeoutError: unknown;
  const startedWait = Date.now();
  try {
    await trackerB.ensureOrigin("b.test");
  } catch (error) {
    timeoutError = error;
  }
  check("saturated new origin times out with a clear, retryable error", timeoutError instanceof OriginClaimTimeoutError, String(timeoutError));
  check("timeout respected (bounded wait, no deadlock)", Date.now() - startedWait < 2_000);
  await trackerB.ensureOrigin("c.test");
  check("other origins continue running (c.test acquired while b.test saturated)", trackerB.origin === "c.test" && locks.isHeld("origin:c.test"));

  await trackerA.release();
  check("release frees the tracker's current origin", !locks.isHeld("origin:b.test"));
  await trackerB.release();

  const disabledTracker = new OriginClaimTracker("inst-C", locks, { enabled: false, timeoutMs: 300 });
  await disabledTracker.ensureOrigin("d.test");
  check("disabled tracker (AWKIT_DYNAMIC_ORIGIN_CLAIMS=0) never claims", !locks.isHeld("origin:d.test"));

  console.log("\nPart B — live StepExecutor integration (127.0.0.1 → localhost = real origin change)");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>origin lab</h1></body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const liveLocks = new ResourceLockManager({ "origin:*": 2 });
  const liveTracker = new OriginClaimTracker("inst-live", liveLocks, { enabled: true, timeoutMs: 2_000, log: () => undefined });
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const context = {
    executionId: "e-origin",
    instanceId: "inst-live",
    scenarioId: "s-origin",
    flowId: "f-origin",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: tmpdir(), screenshots: tmpdir(), logs: join(tmpdir(), "o.jsonl"), reports: join(tmpdir(), "o.json") }
  } as unknown as InstanceExecutionContext;
  const executor = new StepExecutor(
    page,
    new LocatorFactory(page),
    new ValueResolver(context),
    context,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    liveTracker
  );

  const goto1: FlowStep = { id: "g1", type: "goto", name: "Open on 127.0.0.1", url: `http://127.0.0.1:${port}/` } as FlowStep;
  const result1 = await executor.execute(goto1);
  check("first navigation claims origin:127.0.0.1", result1.status === "passed" && liveTracker.origin === "127.0.0.1" && liveLocks.isHeld("origin:127.0.0.1"));

  const goto2: FlowStep = { id: "g2", type: "goto", name: "Open on localhost", url: `http://localhost:${port}/` } as FlowStep;
  const result2 = await executor.execute(goto2);
  check("cross-origin navigation moves the claim to origin:localhost", result2.status === "passed" && liveTracker.origin === "localhost" && liveLocks.isHeld("origin:localhost"));
  check("previous origin released after the live transition", !liveLocks.isHeld("origin:127.0.0.1"));
  check("live transition recorded", liveTracker.transitions.some((t) => t.to === "localhost"));

  await liveTracker.release();
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-dynamic-origin-claims crashed:", error);
  process.exit(1);
});
