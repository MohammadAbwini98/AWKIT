/**
 * Lock-safety verification (deterministic, no live websites).
 * Run with: npx tsx scripts/verify-locks.mts
 *
 * Proves: exclusive profile locking (manager + real BrowserContextFactory path), lock release
 * after success / thrown error / failed persistent-context launch, kind-prefix semaphore
 * capacities (origin:* / account:*), and active + stale lock snapshots.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { profileKey } from "@src/runner/concurrency/ResourceKey";
import { BrowserContextFactory, PersistentProfileInUseError } from "@src/runner/BrowserContextFactory";
import { globalProfileLocks, ProfileLockedError } from "@src/profiles/ProfileLockManager";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function partA_managerLevel(): Promise<void> {
  console.log("\nPart A — ResourceLockManager profile safety");
  const locks = new ResourceLockManager();
  const key = profileKey("C:\\profiles\\shared");

  const first = locks.tryAcquire("inst-1", { key, mode: "exclusive" });
  const second = locks.tryAcquire("inst-2", { key, mode: "exclusive" });
  check("two concurrent profile acquisitions: second fails", first !== null && second === null);

  // Release after successful run (withLocks happy path).
  await locks.withLocks("inst-3", [{ key: "profile:run-ok", mode: "exclusive" }], async () => undefined);
  check("lock released after successful run", !locks.isHeld("profile:run-ok"));

  // Release after thrown error.
  await locks
    .withLocks("inst-4", [{ key: "profile:run-throw", mode: "exclusive" }], async () => {
      throw new Error("boom");
    })
    .catch(() => undefined);
  check("lock released after thrown error", !locks.isHeld("profile:run-throw"));

  locks.releaseMany([first!]);
  check("released profile is re-acquirable", locks.tryAcquire("inst-2", { key, mode: "exclusive" }) !== null);
}

async function partB_kindCapacities(): Promise<void> {
  console.log("\nPart B — kind-prefix semaphore capacities");
  const locks = new ResourceLockManager({ "origin:*": 2, "account:*": 1, "origin:special.test": 3 });

  const o1 = locks.tryAcquire("i1", { key: "origin:example.test", mode: "semaphore" });
  const o2 = locks.tryAcquire("i2", { key: "origin:example.test", mode: "semaphore" });
  const o3 = locks.tryAcquire("i3", { key: "origin:example.test", mode: "semaphore" });
  check("origin:* capacity 2 enforced", o1 !== null && o2 !== null && o3 === null);

  const other = locks.tryAcquire("i3", { key: "origin:other.test", mode: "semaphore" });
  check("saturating one origin does not block another origin", other !== null);

  const a1 = locks.tryAcquire("i4", { key: "account:acct-1", mode: "semaphore" });
  const a2 = locks.tryAcquire("i5", { key: "account:acct-1", mode: "semaphore" });
  check("account:* capacity 1 enforced", a1 !== null && a2 === null);

  const s1 = locks.tryAcquire("i6", { key: "origin:special.test", mode: "semaphore" });
  const s2 = locks.tryAcquire("i7", { key: "origin:special.test", mode: "semaphore" });
  const s3 = locks.tryAcquire("i8", { key: "origin:special.test", mode: "semaphore" });
  check("exact-key capacity overrides kind prefix (3)", s1 !== null && s2 !== null && s3 !== null);
}

async function partC_snapshots(): Promise<void> {
  console.log("\nPart C — active + stale lock snapshots");
  const locks = new ResourceLockManager();
  locks.tryAcquire("live-owner", { key: "profile:active", mode: "exclusive" });
  locks.tryAcquire("dead-owner", { key: "profile:stale", mode: "exclusive", ttlMs: 1 });
  await sleep(15);

  const raw = locks.snapshot(false);
  const staleVisible = raw.some((entry) => entry.key === "profile:stale" && entry.holders.some((holder) => holder.expiresAt! <= Date.now()));
  check("snapshot(false) shows expired-but-unswept lease", staleVisible);
  check("snapshot(false) shows active lease", raw.some((entry) => entry.key === "profile:active"));

  const swept = locks.snapshot(); // default sweeps first
  check("default snapshot sweeps stale leases", !swept.some((entry) => entry.key === "profile:stale") && swept.some((entry) => entry.key === "profile:active"));
}

async function partD_factoryPath(): Promise<void> {
  console.log("\nPart D — BrowserContextFactory lock lifecycle (no browser launch needed)");
  const root = await mkdtemp(join(tmpdir(), "wfs-locks-"));
  const userDataDir = join(root, "profile");
  await mkdir(userDataDir, { recursive: true });
  // Force the post-lock launch path to fail deterministically: a Chrome lock artifact makes
  // assertPersistentProfileAvailable throw AFTER the in-process profile lock is acquired.
  await writeFile(join(userDataDir, "lockfile"), "x", "utf8");

  const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });
  const config: InstanceConfig = {
    id: "lk-1",
    name: "lk-1",
    browser: "chromium",
    headless: true,
    isolationMode: "persistentContext",
    userDataDir,
    timeoutMs: 30_000,
    viewport: { width: 800, height: 600 }
  };
  const context = {
    executionId: "e-lk",
    instanceId: "lk-1",
    scenarioId: "s-lk",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: join(root, "dl"), screenshots: join(root, "shots"), logs: join(root, "l.jsonl"), reports: join(root, "r.json") }
  } as unknown as InstanceExecutionContext;

  let launchError: unknown;
  try {
    await factory.create(config, context);
  } catch (error) {
    launchError = error;
  }
  check("failed launch rejects with profile-in-use error", launchError instanceof PersistentProfileInUseError, String(launchError));
  check("profile lock RELEASED after failed launch", !globalProfileLocks.isLocked(userDataDir));

  // With the lock still held by someone else, a second caller fails with ProfileLockedError
  // (in-process) BEFORE reaching the artifact check.
  const lease = globalProfileLocks.acquire("other-instance", userDataDir, "verify");
  let lockedError: unknown;
  try {
    await factory.create({ ...config, id: "lk-2" }, { ...context, instanceId: "lk-2" } as InstanceExecutionContext);
  } catch (error) {
    lockedError = error;
  }
  check("concurrent factory create rejected by in-process profile lock", lockedError instanceof ProfileLockedError, String(lockedError));
  lease.release();
  check("lease.release() frees the profile", !globalProfileLocks.isLocked(userDataDir));

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

async function main(): Promise<void> {
  console.log("Lock-safety verification");
  await partA_managerLevel();
  await partB_kindCapacities();
  await partC_snapshots();
  await partD_factoryPath();
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-locks crashed:", error);
  process.exit(1);
});
