/**
 * Aggregated runtime status for the UI / IPC status API. Pure assembly over the snapshot
 * sources (backpressure, lock manager, browser pool, watchdog) so it is testable without
 * Electron and cheap to poll.
 */
import type { BrowserPoolSnapshot } from "../browser/BrowserWorkerPool";
import type { ProcessTreeSample } from "../runtime/ProcessTreeSampler";
import type { WatchdogSnapshot } from "../runtime/WatchdogService";
import type { DurableLockSnapshot } from "../store/DurableLockStore";
import type { DurableRunRecord } from "../store/RuntimeStoreSchema";
import type { CapacitySnapshot } from "./CapacitySnapshot";
import type { LockSnapshotEntry } from "./ResourceLockManager";

export interface LockDebugSnapshot {
  entries: LockSnapshotEntry[];
  totalHeld: number;
  profileLocks: number;
  downloadDirLocks: number;
  originLocks: number;
  accountLocks: number;
  /** Leases past their TTL at snapshot time (visible until the next sweep). */
  staleLocks: number;
}

/** Where the durable runtime actually lives (Phase 4B diagnostics — no secrets). */
export interface RuntimeEnvironmentInfo {
  appMode: "dev" | "packaged";
  runtimeRoot: string;
  sqlitePath: string;
  artifactsRoot: string;
  /** Resolved sql.js WASM file; undefined = sql.js default script-directory resolution. */
  sqlJsWasmPath?: string;
  durableStoreEnabled: boolean;
}

export interface RuntimeStatusSnapshot {
  timestamp: string;
  capacity: CapacitySnapshot;
  locks: LockDebugSnapshot;
  browserPool: BrowserPoolSnapshot;
  watchdog: WatchdogSnapshot;
  /** Durable cross-process locks (Phase 3): live holders + quarantined stale records. */
  durableLocks?: DurableLockSnapshot;
  /** Interrupted prior runs found at startup (Phase 3 recovery), bounded. */
  recoverableRuns?: DurableRunRecord[];
  /** Runtime store/artifact paths + app mode (Phase 4B); set once the durable init ran. */
  environment?: RuntimeEnvironmentInfo;
  /** Latest Chrome/host process-tree consumption sample (reporting); undefined when unsampled. */
  processes?: ProcessTreeSample;
}

export function buildLockDebugSnapshot(entries: LockSnapshotEntry[], now = Date.now()): LockDebugSnapshot {
  const countKind = (kind: string): number => entries.filter((entry) => entry.key.startsWith(`${kind}:`)).length;
  return {
    entries,
    totalHeld: entries.reduce((sum, entry) => sum + entry.holders.length, 0),
    profileLocks: countKind("profile"),
    downloadDirLocks: countKind("downloadDir"),
    originLocks: countKind("origin"),
    accountLocks: countKind("account"),
    staleLocks: entries.reduce(
      (sum, entry) => sum + entry.holders.filter((holder) => holder.expiresAt !== undefined && holder.expiresAt <= now).length,
      0
    )
  };
}

export function buildRuntimeStatus(input: {
  capacity: CapacitySnapshot;
  lockEntries: LockSnapshotEntry[];
  browserPool: BrowserPoolSnapshot;
  watchdog: WatchdogSnapshot;
  durableLocks?: DurableLockSnapshot;
  recoverableRuns?: DurableRunRecord[];
  environment?: RuntimeEnvironmentInfo;
  processes?: ProcessTreeSample;
}): RuntimeStatusSnapshot {
  return {
    timestamp: new Date().toISOString(),
    capacity: input.capacity,
    locks: buildLockDebugSnapshot(input.lockEntries),
    browserPool: input.browserPool,
    watchdog: input.watchdog,
    durableLocks: input.durableLocks,
    recoverableRuns: input.recoverableRuns,
    environment: input.environment,
    processes: input.processes
  };
}
