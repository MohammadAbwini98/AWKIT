/**
 * Durable cross-process lock verification. Spawns a REAL second Node process (via tsx) that
 * acquires locks in the shared on-disk lock store, proving two processes cannot share an
 * exclusive profile lock and that semaphore capacity holds across processes.
 * Run with: npx tsx scripts/verify-durable-locks.mts
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableLockStore } from "@src/runner/store/DurableLockStore";
import { ProfileLockManager } from "@src/profiles/ProfileLockManager";
import { configureDurableLocks } from "@src/runner/store/DurableLockConfig";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";

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

const TSX_CLI = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const CHILD = join(process.cwd(), "scripts", "helpers", "durable-lock-child.mts");

/** Spawn the child, resolve when it prints ACQUIRED/DENIED, return the process + first line. */
function spawnChild(args: string[]): Promise<{ firstLine: string; done: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CHILD, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let buffer = "";
    let resolved = false;
    const done = new Promise<void>((resolveDone) => child.on("exit", () => resolveDone()));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split(/\r?\n/)[0];
      if (!resolved && (line === "ACQUIRED" || line === "DENIED")) {
        resolved = true;
        resolve({ firstLine: line, done });
      }
    });
    child.on("error", reject);
    setTimeout(() => {
      if (!resolved) reject(new Error("child did not report within 30s"));
    }, 30_000).unref();
  });
}

async function main(): Promise<void> {
  console.log("Durable cross-process lock verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-durable-locks-"));

  console.log("\nPart A — exclusive profile lock across two REAL processes");
  const profileKeyStr = "profile:c:/profiles/shared-x";
  const childA = await spawnChild([root, "exclusive", profileKeyStr, "4000"]);
  check("child process acquired the durable profile lock", childA.firstLine === "ACQUIRED");

  const store = new DurableLockStore(root, { "origin:*": 2, "account:*": 1 });
  const parentAttempt = await store.acquireExclusive("parent-owner", profileKeyStr, { reason: "parent attempt" });
  check("parent process CANNOT acquire the same durable profile lock", parentAttempt === null);

  const snapshotHeld = await store.snapshot();
  check("durable lock snapshot shows the child's holder (pid + app instance recorded)", snapshotHeld.active.some((r) => r.key === profileKeyStr && r.pid > 0 && !!r.appInstanceId));

  await childA.done;
  const parentAfter = await store.acquireExclusive("parent-owner", profileKeyStr, { reason: "after child release" });
  check("parent acquires after the child releases", parentAfter !== null);
  check("fencing versions are monotonic across grants", parentAfter !== null && snapshotHeld.active.every((r) => r.key !== profileKeyStr || parentAfter.version > r.version));
  await parentAfter!.release();

  console.log("\nPart B — semaphore capacity across processes (origin:* capacity 2)");
  const originKey = "origin:shared-site.test";
  const childB = await spawnChild([root, "semaphore", originKey, "4000", "2"]);
  check("child holds 2 origin units", childB.firstLine === "ACQUIRED");
  const parentUnit = await store.acquireSemaphore("parent-sem", originKey, { reason: "parent unit" });
  check("parent denied the 3rd unit (capacity 2 across processes)", parentUnit === null);
  const otherOrigin = await store.acquireSemaphore("parent-sem", "origin:other-site.test", { reason: "different origin" });
  check("a different origin is unaffected", otherOrigin !== null);
  await otherOrigin!.release();
  await childB.done;
  const parentUnitAfter = await store.acquireSemaphore("parent-sem", originKey, { reason: "after child release" });
  check("unit available after child releases", parentUnitAfter !== null);
  await parentUnitAfter!.release();

  console.log("\nPart C — stale detection (TTL + dead pid), quarantined not deleted");
  const ttlLease = await store.acquireExclusive("ttl-owner", "profile:ttl-case", { ttlMs: 30, reason: "short ttl" });
  check("ttl lease acquired", ttlLease !== null);
  await sleep(60);
  // Dead-pid case: hand-craft a holder file owned by a pid that cannot exist.
  const deadDir = join(root, "profile~dead-case-manual");
  mkdirSync(deadDir, { recursive: true });
  await writeFile(
    join(deadDir, "holder.lock"),
    JSON.stringify({ key: "profile:dead-case", ownerId: "ghost", mode: "exclusive", units: 1, version: 1, pid: 999999999, appInstanceId: "dead-app", acquiredAt: new Date().toISOString() }),
    "utf8"
  );
  const stale = await store.scanStale();
  check("expired-TTL lock marked stale with reason", stale.some((s) => s.key === "profile:ttl-case" && /TTL expired/.test(s.staleReason)));
  check("dead-pid lock marked stale with reason", stale.some((s) => s.key === "profile:dead-case" && /no longer running/.test(s.staleReason)));
  const staleFiles = await readdir(join(root, "stale"));
  check("stale locks quarantined to stale/ (not silently deleted)", staleFiles.length >= 2);
  const snapshotAfter = await store.snapshot();
  check("snapshot exposes stale records for runtime status", snapshotAfter.stale.length >= 2 && snapshotAfter.stale.every((s) => !!s.staleReason && !!s.markedStaleAt));
  check("stale key re-acquirable after quarantine", (await store.acquireExclusive("new-owner", "profile:ttl-case")) !== null);

  console.log("\nPart D — ProfileLockManager durable integration");
  configureDurableLocks(store);
  const manager = new ProfileLockManager(new ResourceLockManager());
  const lease1 = await manager.acquireDurable("inst-A", "C:\\profiles\\integrated");
  let deniedError: unknown;
  try {
    // Different in-memory manager (fresh) — only the DURABLE layer can stop this one.
    await new ProfileLockManager(new ResourceLockManager()).acquireDurable("inst-B", "C:\\profiles\\integrated");
  } catch (error) {
    deniedError = error;
  }
  check("second acquire (as if another process) denied by durable layer", deniedError instanceof Error && deniedError.name === "ProfileLockedError");
  lease1.release();
  await sleep(50); // durable release is async fire-and-forget in the lease
  const lease2 = await manager.acquireDurable("inst-B", "C:\\profiles\\integrated");
  check("release in finally frees both layers", !!lease2);
  lease2.release();
  configureDurableLocks(undefined);

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-durable-locks crashed:", error);
  process.exit(1);
});
