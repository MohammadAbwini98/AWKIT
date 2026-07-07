/**
 * Durable cross-process lock store.
 *
 * Atomicity comes from the filesystem, not SQLite: exclusive locks are files created with the
 * `wx` flag (atomic create-if-absent on NTFS/POSIX), semaphore units are per-owner files in a
 * key directory with deterministic rank-based capacity resolution. This is what actually stops
 * TWO AWKIT app processes from opening the same persistent profile — a WASM in-memory SQLite
 * database cannot provide cross-process mutual exclusion, so lock truth lives on disk here and
 * is mirrored into the SQLite runtime store for history/status only.
 *
 * Stale handling: expired-TTL or dead-pid holders are never silently deleted — they are MOVED to
 * a `stale/` folder with an added `staleReason`, so a crashed instance's locks stay inspectable.
 * Fencing: every grant gets a monotonic version (epoch-millis + per-process counter); releases
 * verify the on-disk version matches the lease before deleting.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_INSTANCE_ID, APP_PID, isPidAlive } from "./AppInstance";

export type DurableLockMode = "exclusive" | "semaphore";

export interface DurableLockRecord {
  key: string;
  ownerId: string;
  mode: DurableLockMode;
  units: number;
  version: number;
  pid: number;
  appInstanceId: string;
  reason?: string;
  acquiredAt: string;
  expiresAt?: string;
}

export interface DurableStaleRecord extends DurableLockRecord {
  staleReason: string;
  markedStaleAt: string;
}

export interface DurableLease extends DurableLockRecord {
  release(): Promise<void>;
}

export interface DurableLockSnapshot {
  active: DurableLockRecord[];
  stale: DurableStaleRecord[];
}

let versionCounter = 0;
/** Monotonic-enough fencing version across processes: epoch millis * 1000 + counter. */
function nextVersion(): number {
  versionCounter = (versionCounter + 1) % 1000;
  return Date.now() * 1000 + versionCounter;
}

function keyDirName(key: string): string {
  const sanitized = key.replace(/[^\w.-]+/g, "~").slice(0, 80);
  const hash = createHash("md5").update(key).digest("hex").slice(0, 8);
  return `${sanitized}-${hash}`;
}

function isExpired(record: DurableLockRecord, now: number): boolean {
  return record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now;
}

export class DurableLockStore {
  constructor(
    private readonly rootDir: string,
    private readonly capacities: Record<string, number> = {},
    private readonly defaultSemaphoreCapacity = 4
  ) {}

  get directory(): string {
    return this.rootDir;
  }

  /** Try to take the exclusive lock. Returns null when a live holder exists. */
  async acquireExclusive(ownerId: string, key: string, options?: { ttlMs?: number; reason?: string }): Promise<DurableLease | null> {
    const dir = join(this.rootDir, keyDirName(key));
    await mkdir(dir, { recursive: true });
    const holderPath = join(dir, "holder.lock");
    const record = this.makeRecord(key, ownerId, "exclusive", 1, options);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(holderPath, JSON.stringify(record, null, 2), { flag: "wx" });
        return this.toLease(record, holderPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows: a `wx` create racing a concurrent release/unlink of the same holder file
        // surfaces as EPERM/EBUSY rather than EEXIST. That is lock contention, not an I/O
        // fault — deny cleanly (retry once first) instead of throwing (found by
        // verify:stress:locks).
        if (code === "EPERM" || code === "EBUSY") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          continue;
        }
        if (code !== "EEXIST") throw error;
        const existing = await this.readRecord(holderPath);
        if (!existing) {
          // Corrupt/empty holder file: quarantine it with a reason and retry once.
          await this.quarantine(holderPath, existing, "unreadable holder file");
          continue;
        }
        const staleReason = this.staleReasonFor(existing);
        if (!staleReason) return null; // live holder — genuinely locked
        await this.quarantine(holderPath, existing, staleReason);
      }
    }
    return null;
  }

  /** Try to take one semaphore unit. Returns null when the key is at capacity. */
  async acquireSemaphore(ownerId: string, key: string, options?: { ttlMs?: number; reason?: string; capacity?: number }): Promise<DurableLease | null> {
    const capacity = options?.capacity ?? this.capacityFor(key);
    const unitsDir = join(this.rootDir, keyDirName(key), "units");
    await mkdir(unitsDir, { recursive: true });
    const record = this.makeRecord(key, ownerId, "semaphore", 1, options);
    const unitPath = join(unitsDir, `${keyDirName(ownerId)}-${record.version}.unit`);

    try {
      await writeFile(unitPath, JSON.stringify(record, null, 2), { flag: "wx" });
    } catch {
      return null; // duplicate owner+version collision — treat as unavailable
    }

    // Post-write capacity check: rank live units by (version); keep the first `capacity`.
    const live = await this.liveUnits(unitsDir);
    const ranked = live.sort((a, b) => a.record.version - b.record.version);
    const myRank = ranked.findIndex((unit) => unit.record.version === record.version && unit.record.ownerId === ownerId);
    if (myRank === -1 || myRank >= capacity) {
      await rm(unitPath, { force: true });
      return null;
    }
    return this.toLease(record, unitPath);
  }

  async release(lease: DurableLockRecord & { filePath?: string }): Promise<void> {
    const path = (lease as { filePath?: string }).filePath;
    if (!path) return;
    const existing = await this.readRecord(path);
    // Fencing: only delete when the on-disk version is OUR grant (never clobber a successor).
    if (existing && existing.version !== lease.version) return;
    await rm(path, { force: true });
  }

  /**
   * Startup scan: move expired/dead-pid holders and units to `stale/` with a recorded reason.
   * Returns what was marked. Nothing is silently deleted.
   */
  async scanStale(): Promise<DurableStaleRecord[]> {
    const marked: DurableStaleRecord[] = [];
    const keyDirs = await readdir(this.rootDir).catch(() => [] as string[]);
    for (const keyDir of keyDirs) {
      if (keyDir === "stale") continue;
      const dir = join(this.rootDir, keyDir);

      const holderPath = join(dir, "holder.lock");
      const holder = await this.readRecord(holderPath);
      if (holder) {
        const staleReason = this.staleReasonFor(holder);
        if (staleReason) {
          const stale = await this.quarantine(holderPath, holder, staleReason);
          if (stale) marked.push(stale);
        }
      }

      const unitsDir = join(dir, "units");
      const unitFiles = await readdir(unitsDir).catch(() => [] as string[]);
      for (const unitFile of unitFiles) {
        const unitPath = join(unitsDir, unitFile);
        const unit = await this.readRecord(unitPath);
        if (!unit) continue;
        const staleReason = this.staleReasonFor(unit);
        if (staleReason) {
          const stale = await this.quarantine(unitPath, unit, staleReason);
          if (stale) marked.push(stale);
        }
      }
    }
    return marked;
  }

  /** Full view for runtime status: live holders/units + quarantined stale records. */
  async snapshot(): Promise<DurableLockSnapshot> {
    const active: DurableLockRecord[] = [];
    const stale: DurableStaleRecord[] = [];
    const keyDirs = await readdir(this.rootDir).catch(() => [] as string[]);
    for (const keyDir of keyDirs) {
      if (keyDir === "stale") {
        const staleFiles = await readdir(join(this.rootDir, "stale")).catch(() => [] as string[]);
        for (const staleFile of staleFiles) {
          const record = await this.readRecord(join(this.rootDir, "stale", staleFile));
          if (record) stale.push(record as DurableStaleRecord);
        }
        continue;
      }
      const dir = join(this.rootDir, keyDir);
      const holder = await this.readRecord(join(dir, "holder.lock"));
      if (holder) active.push(holder);
      const unitFiles = await readdir(join(dir, "units")).catch(() => [] as string[]);
      for (const unitFile of unitFiles) {
        const unit = await this.readRecord(join(dir, "units", unitFile));
        if (unit) active.push(unit);
      }
    }
    return { active, stale };
  }

  private capacityFor(key: string): number {
    const exact = this.capacities[key];
    if (exact !== undefined) return exact;
    const kind = key.slice(0, key.indexOf(":"));
    return this.capacities[`${kind}:*`] ?? this.defaultSemaphoreCapacity;
  }

  private makeRecord(key: string, ownerId: string, mode: DurableLockMode, units: number, options?: { ttlMs?: number; reason?: string }): DurableLockRecord {
    const now = Date.now();
    return {
      key,
      ownerId,
      mode,
      units,
      version: nextVersion(),
      pid: APP_PID,
      appInstanceId: APP_INSTANCE_ID,
      reason: options?.reason,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: options?.ttlMs && options.ttlMs > 0 ? new Date(now + options.ttlMs).toISOString() : undefined
    };
  }

  private toLease(record: DurableLockRecord, filePath: string): DurableLease {
    const store = this;
    let released = false;
    return {
      ...record,
      async release() {
        if (released) return;
        released = true;
        await store.release({ ...record, filePath }).catch(() => undefined);
      }
    };
  }

  /** Why a holder is stale, or undefined when it is live. */
  private staleReasonFor(record: DurableLockRecord, now = Date.now()): string | undefined {
    if (isExpired(record, now)) return `lease TTL expired at ${record.expiresAt}`;
    // Same-process locks are never stale by pid; other processes must be alive.
    if (record.pid !== APP_PID && !isPidAlive(record.pid)) return `owning process ${record.pid} is no longer running`;
    return undefined;
  }

  /** Move a stale/corrupt lock file into `stale/` with the reason recorded (never delete). */
  private async quarantine(path: string, record: DurableLockRecord | undefined, staleReason: string): Promise<DurableStaleRecord | undefined> {
    const staleDir = join(this.rootDir, "stale");
    await mkdir(staleDir, { recursive: true });
    const stale: DurableStaleRecord | undefined = record
      ? { ...record, staleReason, markedStaleAt: new Date().toISOString() }
      : undefined;
    const target = join(staleDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.stale.json`);
    try {
      if (stale) {
        await writeFile(target, JSON.stringify(stale, null, 2), "utf8");
        await rm(path, { force: true });
      } else {
        await rename(path, target);
      }
    } catch {
      // Another process may have quarantined it concurrently — fine.
    }
    return stale;
  }

  private async readRecord(path: string): Promise<DurableLockRecord | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as DurableLockRecord;
    } catch {
      return undefined;
    }
  }

  private async liveUnits(unitsDir: string): Promise<Array<{ path: string; record: DurableLockRecord }>> {
    const files = await readdir(unitsDir).catch(() => [] as string[]);
    const out: Array<{ path: string; record: DurableLockRecord }> = [];
    for (const file of files) {
      const path = join(unitsDir, file);
      const record = await this.readRecord(path);
      if (record && !this.staleReasonFor(record)) out.push({ path, record });
    }
    return out;
  }
}
