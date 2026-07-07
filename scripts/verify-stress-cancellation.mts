/**
 * Cancellation stress verification (Phase 4E — deterministic, fake runtimes, no browsers).
 * Run with: npm run verify:stress:cancellation
 *
 * Proves under churn: many cancelled runs always release their browser slots, cancel handlers
 * close the (fake) browser exactly once, in-flight work rejects promptly, the `cancelled`
 * error class is never retryable, and queued instances cancelled before dispatch never leak
 * a slot. Mirrors the engine contract: onCancel closes the runtime; `finally` releases.
 *
 * Tunables: AWKIT_STRESS_INSTANCES (25), AWKIT_STRESS_MAX_BROWSERS (2),
 *           AWKIT_STRESS_TIMEOUT_MS (120000).
 */
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";
import { loadConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";
import { CancellationTokenSource, CancelledError } from "@src/runner/concurrency/CancellationToken";
import { classifyError, RETRYABLE_ERROR_CLASSES } from "@src/runner/runtime/ErrorClassifier";

const STRESS_INSTANCES = envInt("AWKIT_STRESS_INSTANCES", 25);
const STRESS_MAX_BROWSERS = envInt("AWKIT_STRESS_MAX_BROWSERS", 2);
const STRESS_TIMEOUT_MS = envInt("AWKIT_STRESS_TIMEOUT_MS", 120_000);

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

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log(`Cancellation stress verification (${STRESS_INSTANCES} runs, cap ${STRESS_MAX_BROWSERS})`);

  console.log("\nPart A — mass cancellation releases every slot and closes every browser once");
  const pool = new BrowserWorkerPool(loadConcurrencyLimits({ maxBrowsersPerHost: STRESS_MAX_BROWSERS, minFreeMemoryMb: 0 }));
  const sources = new Map<string, CancellationTokenSource>();
  const browserCloseCounts = new Map<string, number>();
  const outcomes = new Map<string, string>();
  let maxConcurrent = 0;

  const runInstance = async (instanceId: string): Promise<void> => {
    const source = new CancellationTokenSource();
    sources.set(instanceId, source);

    // Wait for a slot exactly like the engine tick; a cancel while queued must end the run
    // without ever acquiring (or leaking) a slot.
    let slot = pool.tryAcquireSlot(instanceId);
    while (!slot) {
      if (source.token.cancelled) {
        outcomes.set(instanceId, "cancelledWhileQueued");
        return;
      }
      await sleep(2);
      slot = pool.tryAcquireSlot(instanceId);
    }

    // "Launch" the browser and register the hard-cancel handler (the engine contract).
    browserCloseCounts.set(instanceId, 0);
    source.token.onCancel(() => {
      browserCloseCounts.set(instanceId, (browserCloseCounts.get(instanceId) ?? 0) + 1);
    });

    try {
      maxConcurrent = Math.max(maxConcurrent, pool.snapshot().activeSlots);
      // In-flight work: a long "step" that rejects as soon as the token cancels.
      for (let step = 0; step < 1000; step += 1) {
        source.token.throwIfCancelled();
        await sleep(2);
      }
      outcomes.set(instanceId, "completed");
    } catch (error) {
      outcomes.set(instanceId, error instanceof CancelledError ? "cancelled" : "failed");
    } finally {
      pool.releaseSlot(slot);
    }
  };

  const runs = Array.from({ length: STRESS_INSTANCES }, (_, index) => runInstance(`cancel-i${index}`));
  // Cancel every run shortly after launch, spread over time to hit queued AND running states.
  await sleep(5);
  const cancelAll = [...sources.entries()].map(async ([instanceId, source], index) => {
    await sleep(index % 20);
    await source.cancel("stress stop-all");
  });
  await Promise.all([Promise.all(runs), Promise.all(cancelAll)]);

  const cancelledCount = [...outcomes.values()].filter((outcome) => outcome === "cancelled" || outcome === "cancelledWhileQueued").length;
  check(`every run ended (${outcomes.size}/${STRESS_INSTANCES})`, outcomes.size === STRESS_INSTANCES);
  check(`every run ended cancelled, none failed/completed (${cancelledCount} cancelled)`, cancelledCount === STRESS_INSTANCES, JSON.stringify([...outcomes.values()].filter((o) => o !== "cancelled" && o !== "cancelledWhileQueued")));
  check("all browser slots released after mass cancel", pool.snapshot().activeSlots === 0, `activeSlots=${pool.snapshot().activeSlots}`);
  check(`browser cap held during churn (max ${maxConcurrent} ≤ ${STRESS_MAX_BROWSERS})`, maxConcurrent <= STRESS_MAX_BROWSERS);
  const doubleClosed = [...browserCloseCounts.entries()].filter(([, count]) => count !== 1);
  check("each launched browser's cancel handler ran exactly once", doubleClosed.length === 0, JSON.stringify(doubleClosed.slice(0, 3)));

  console.log("\nPart B — cancelled error class is terminal, never retried");
  const errorClass = classifyError(new CancelledError("stress"));
  check(`CancelledError classifies as "cancelled" (got "${errorClass}")`, errorClass === "cancelled");
  check("\"cancelled\" is not a retryable error class", !RETRYABLE_ERROR_CLASSES.has(errorClass));

  console.log("\nPart C — cancel is idempotent under repeated stop requests");
  const source = new CancellationTokenSource();
  let handlerRuns = 0;
  source.token.onCancel(() => {
    handlerRuns += 1;
  });
  await Promise.all(Array.from({ length: 50 }, () => source.cancel("repeat")));
  check("50 concurrent cancel() calls run the handler once", handlerRuns === 1, `handlerRuns=${handlerRuns}`);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

const timeout = setTimeout(() => {
  console.error(`✗ Stress run exceeded AWKIT_STRESS_TIMEOUT_MS (${STRESS_TIMEOUT_MS}ms) — possible deadlock.`);
  process.exit(1);
}, STRESS_TIMEOUT_MS);
timeout.unref();

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
