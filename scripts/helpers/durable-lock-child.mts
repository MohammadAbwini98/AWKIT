/**
 * Child process helper for verify-durable-locks: acquires a durable lock in a SEPARATE Node
 * process and holds it while the parent tries to acquire the same key.
 *
 * Usage: tsx scripts/helpers/durable-lock-child.mts <rootDir> <mode> <key> <holdMs> [units]
 * Prints "ACQUIRED" or "DENIED" on stdout, holds, then releases and prints "RELEASED".
 */
import { DurableLockStore } from "@src/runner/store/DurableLockStore";

async function main(): Promise<void> {
  const [rootDir, mode, key, holdMsRaw, unitsRaw] = process.argv.slice(2);
  const holdMs = Number.parseInt(holdMsRaw ?? "2000", 10);
  const units = Number.parseInt(unitsRaw ?? "1", 10);
  const store = new DurableLockStore(rootDir, { "origin:*": 2, "account:*": 1 });

  const leases = [];
  for (let i = 0; i < units; i += 1) {
    const lease =
      mode === "exclusive"
        ? await store.acquireExclusive(`child-${process.pid}-${i}`, key, { reason: "verify child" })
        : await store.acquireSemaphore(`child-${process.pid}-${i}`, key, { reason: "verify child" });
    if (!lease) {
      console.log("DENIED");
      process.exit(0);
    }
    leases.push(lease);
  }
  console.log("ACQUIRED");
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  for (const lease of leases) await lease.release();
  console.log("RELEASED");
}

main().catch((error) => {
  console.error("child crashed:", error);
  process.exit(1);
});
