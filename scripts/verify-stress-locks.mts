/**
 * Lock stress verification (Phase 4E — deterministic, no browsers).
 * Run with: npm run verify:stress:locks
 *
 * Proves under churn: many concurrent profile-lock attempts never grant two holders at once
 * and never corrupt the lock table; durable cross-process lock files stay consistent through
 * rapid acquire/release cycles (no leftover holders, snapshot parses); and many dynamic
 * origin transitions through the real OriginClaimTracker complete without deadlock while
 * honouring the per-origin capacity.
 *
 * Tunables: AWKIT_STRESS_INSTANCES (25), AWKIT_STRESS_TIMEOUT_MS (120000).
 */
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { OriginClaimTracker, OriginClaimTimeoutError } from "@src/runner/concurrency/OriginClaimTracker";
import { ProfileLockManager } from "@src/profiles/ProfileLockManager";
import { DurableLockStore } from "@src/runner/store/DurableLockStore";

const STRESS_INSTANCES = envInt("AWKIT_STRESS_INSTANCES", 25);
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

/** Recursive file listing (Node 18.16 has no readdir({recursive})). */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    const full = join(dir, entry);
    const info = await stat(full).catch(() => undefined);
    if (!info) continue;
    if (info.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`Lock stress verification (${STRESS_INSTANCES} workers)`);

  console.log("\nPart A — profile locks: never two holders, table stays clean");
  const locks = new ResourceLockManager();
  const profiles = new ProfileLockManager(locks);
  const profileDirs = Array.from({ length: 5 }, (_, index) => `C:\\stress\\profile-${index}`);
  let grants = 0;
  let denials = 0;
  let overlapViolations = 0;
  const holdersNow = new Map<string, number>();

  await Promise.all(
    Array.from({ length: STRESS_INSTANCES }, (_, worker) =>
      (async () => {
        for (let round = 0; round < 20; round += 1) {
          const dir = profileDirs[(worker + round) % profileDirs.length];
          try {
            const lease = profiles.acquire(`stress-w${worker}`, dir, "stress");
            grants += 1;
            const concurrent = (holdersNow.get(dir) ?? 0) + 1;
            holdersNow.set(dir, concurrent);
            if (concurrent > 1) overlapViolations += 1;
            await sleep(1 + (round % 3));
            holdersNow.set(dir, (holdersNow.get(dir) ?? 1) - 1);
            lease.release();
          } catch {
            denials += 1;
            await sleep(1);
          }
        }
      })()
    )
  );
  check(`grants and clean denials both occurred (${grants} grants, ${denials} denials)`, grants > 0 && denials > 0);
  check("no profile ever had two concurrent holders", overlapViolations === 0, `violations=${overlapViolations}`);
  const leftover = locks.snapshot();
  check("lock table empty after churn (no leaked leases)", leftover.length === 0, JSON.stringify(leftover.slice(0, 3)));

  console.log("\nPart B — durable lock files: rapid cycles do not corrupt the store");
  const durableDir = await mkdtemp(join(tmpdir(), "awkit-stress-locks-"));
  const durable = new DurableLockStore(durableDir, { "origin:*": 2 });
  let durableGrants = 0;
  let durableDenials = 0;
  await Promise.all(
    Array.from({ length: STRESS_INSTANCES }, (_, worker) =>
      (async () => {
        for (let round = 0; round < 10; round += 1) {
          const lease = await durable.acquireExclusive(`stress-w${worker}`, `profile:C:\\stress\\durable-${round % 3}`, { reason: "stress" });
          if (lease) {
            durableGrants += 1;
            await sleep(1);
            await lease.release();
          } else {
            durableDenials += 1;
            await sleep(1);
          }
        }
      })()
    )
  );
  const durableSnapshot = await durable.snapshot();
  check(`durable grants and denials both occurred (${durableGrants} grants, ${durableDenials} denials)`, durableGrants > 0 && durableDenials > 0);
  check("no durable holders remain after churn", durableSnapshot.active.length === 0, JSON.stringify(durableSnapshot.active.slice(0, 3)));
  check("durable snapshot parses cleanly after churn (no corrupt records)", Array.isArray(durableSnapshot.active) && Array.isArray(durableSnapshot.stale));
  const lockDirEntries = await listFiles(durableDir);
  const leftoverHolderFiles = lockDirEntries.filter((entry) => entry.endsWith("holder.lock") || entry.endsWith(".unit"));
  check("no leftover holder/unit files on disk", leftoverHolderFiles.length === 0, JSON.stringify(leftoverHolderFiles.slice(0, 3)));
  await rm(durableDir, { recursive: true, force: true });

  console.log("\nPart C — dynamic origin transitions: bounded wait, no permanent deadlock");
  // Deliberate over-subscription: 8 workers over 3 origins × capacity 2 (6 units). Transitions
  // acquire-new-then-release-old, so full saturation can circular-wait — the production
  // guarantee is the BOUNDED wait (OriginClaimTimeoutError fails only that step). A worker
  // hitting the timeout releases its claim (like a failed step ending the attempt) and
  // continues, exactly the engine's retry model. The invariant proven here: every worker
  // finishes, capacity is never exceeded, and the lock table drains.
  const originLocks = new ResourceLockManager({ "origin:*": 2 });
  const origins = ["site-a.local", "site-b.local", "site-c.local"];
  const originWorkers = Math.min(STRESS_INSTANCES, 8);
  let originViolations = 0;
  let claimTimeouts = 0;
  let completedWorkers = 0;

  await Promise.all(
    Array.from({ length: originWorkers }, (_, worker) =>
      (async () => {
        const tracker = new OriginClaimTracker(`origin-w${worker}`, originLocks, { enabled: true, timeoutMs: 1000 });
        for (let hop = 0; hop < 12; hop += 1) {
          const host = origins[(worker + hop) % origins.length];
          try {
            await tracker.ensureOrigin(host);
            const holders = originLocks.holdersOf(`origin:${host}`);
            if (holders.length > 2) originViolations += 1;
            await sleep(1 + (hop % 3));
          } catch (error) {
            if (error instanceof OriginClaimTimeoutError) {
              // Saturated target origin: the step fails safely; free our claim and go on.
              claimTimeouts += 1;
              await tracker.release();
            } else {
              throw error;
            }
          }
        }
        await tracker.release();
        completedWorkers += 1;
      })()
    )
  );
  check(`all origin workers completed — bounded wait prevented any permanent deadlock (${completedWorkers}/${originWorkers}, ${claimTimeouts} safe timeouts)`, completedWorkers === originWorkers);
  check("per-origin capacity (2) never exceeded during transitions", originViolations === 0, `violations=${originViolations}`);
  check("origin lock table empty after release", originLocks.snapshot().length === 0);

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
