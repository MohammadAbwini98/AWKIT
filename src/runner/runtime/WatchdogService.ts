/**
 * Watchdog for stuck/orphaned work. Periodically scans active instances and detects:
 *  - stale heartbeat (running but no progress events within the threshold),
 *  - orphaned instances (non-terminal status but the runner promise already settled),
 *  - stale resource locks left behind by finished owners.
 *
 * Recovery is deliberately conservative: the watchdog marks state and releases stale locks;
 * it never force-restarts business flows on its own (dangerous side effects are not retried
 * blindly — the user re-runs via the existing Repeat control). Every action is logged with
 * the exact reason.
 */
import type { ConcurrencyLimits } from "../concurrency/ConcurrencyConfig";
import type { ResourceLockManager } from "../concurrency/ResourceLockManager";

export interface WatchdogInstanceView {
  instanceId: string;
  executionId: string;
  status: string;
  /** Last heartbeat/progress timestamp (ISO). */
  heartbeatAt?: string;
  startedAt?: string;
  /** True while the engine still holds an unsettled runner promise for the instance. */
  runnerActive: boolean;
}

export interface WatchdogFinding {
  instanceId: string;
  kind: "staleHeartbeat" | "orphaned";
  reason: string;
  /** When the finding was raised (ISO). */
  at?: string;
}

/** Diagnostic view of the watchdog for the runtime status API / UI. */
export interface WatchdogSnapshot {
  running: boolean;
  lastScanAt?: string;
  totalFindings: number;
  /** Most recent findings, newest last (bounded). */
  recentFindings: WatchdogFinding[];
  sweptLockCount: number;
  lastSweptLockKey?: string;
}

export interface WatchdogHooks {
  listActiveInstances(): WatchdogInstanceView[];
  /** Called for every finding — the engine decides the status transition (crashed/orphaned→failed). */
  onFinding(finding: WatchdogFinding): void;
  log(message: string): void;
}

export class WatchdogService {
  private timer?: ReturnType<typeof setInterval>;
  /** Findings already reported, so one stuck instance doesn't spam every scan. */
  private readonly reported = new Set<string>();
  private lastScanAt?: string;
  private totalFindings = 0;
  private readonly recentFindings: WatchdogFinding[] = [];
  private sweptLockCount = 0;
  private lastSweptLockKey?: string;

  constructor(
    private readonly hooks: WatchdogHooks,
    private readonly limits: Pick<ConcurrencyLimits, "staleHeartbeatMs" | "watchdogIntervalMs">,
    private readonly locks?: ResourceLockManager
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan(), this.limits.watchdogIntervalMs);
    // Never keep the Electron process alive just for the watchdog.
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scan pass (also callable directly from tests). Returns the new findings. */
  scan(now = Date.now()): WatchdogFinding[] {
    const findings: WatchdogFinding[] = [];
    this.lastScanAt = new Date(now).toISOString();

    for (const view of this.hooks.listActiveInstances()) {
      const finding = this.evaluate(view, now);
      if (!finding) continue;
      const dedupeKey = `${finding.instanceId}:${finding.kind}`;
      if (this.reported.has(dedupeKey)) continue;
      this.reported.add(dedupeKey);
      finding.at = new Date(now).toISOString();
      findings.push(finding);
      this.totalFindings += 1;
      this.recentFindings.push(finding);
      if (this.recentFindings.length > 20) this.recentFindings.splice(0, this.recentFindings.length - 20);
      this.hooks.log(`[watchdog] ${finding.kind}: instance ${finding.instanceId} — ${finding.reason}`);
      this.hooks.onFinding(finding);
    }

    if (this.locks) {
      const swept = this.locks.cleanupStale(now);
      for (const lease of swept) {
        this.sweptLockCount += 1;
        this.lastSweptLockKey = lease.key;
        this.hooks.log(`[watchdog] released stale lock ${lease.key} (owner ${lease.ownerId}, expired lease v${lease.version}).`);
      }
    }

    return findings;
  }

  snapshot(): WatchdogSnapshot {
    return {
      running: this.timer !== undefined,
      lastScanAt: this.lastScanAt,
      totalFindings: this.totalFindings,
      recentFindings: this.recentFindings.map((finding) => ({ ...finding })),
      sweptLockCount: this.sweptLockCount,
      lastSweptLockKey: this.lastSweptLockKey
    };
  }

  /** Forget dedupe state for an instance (e.g. after the user repeats it). */
  clearInstance(instanceId: string): void {
    for (const key of [...this.reported]) {
      if (key.startsWith(`${instanceId}:`)) this.reported.delete(key);
    }
  }

  private evaluate(view: WatchdogInstanceView, now: number): WatchdogFinding | undefined {
    const activeStatuses = ["starting", "running"];

    // Orphaned: the engine no longer runs anything for this instance, yet it looks active.
    if (!view.runnerActive && activeStatuses.includes(view.status)) {
      return {
        instanceId: view.instanceId,
        kind: "orphaned",
        reason: `status "${view.status}" but no active runner promise — marking failed (orphaned)`
      };
    }

    // Stale heartbeat: running with no progress events for longer than the threshold.
    if (view.runnerActive && activeStatuses.includes(view.status)) {
      const last = Date.parse(view.heartbeatAt ?? view.startedAt ?? "");
      if (Number.isFinite(last) && now - last > this.limits.staleHeartbeatMs) {
        return {
          instanceId: view.instanceId,
          kind: "staleHeartbeat",
          reason: `no heartbeat for ${Math.round((now - last) / 1000)}s (threshold ${Math.round(this.limits.staleHeartbeatMs / 1000)}s) — browser or page may be stuck`
        };
      }
    }

    return undefined;
  }
}
